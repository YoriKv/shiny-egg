;#############################################################################################################
;# Bank01.asm -- bank $01 SNES code (HiROM mirror: also reachable as $C1).
;#
;# Contents at a glance:
;#   $01:8000             -- TYX/RTS stub (referenced by Boo Guy pulley state table at $01:AE89)
;#   $01:8002-$01:A226    -- Hookbill the Koopa (sprite $0AE) Init + Main + ~50-state machine
;#                            (fog cinematic -> crawl/walk -> egg-hit cycles -> ground pound -> death)
;#   $01:A248-$01:A57E    -- Naval Piranha closer wall (sprite $0DD) Init + Main, including
;#                            boss-fight closer states (camera, salvo, naval, hookbill)
;#   $01:A5C9-$01:AEB8    -- Misc normal sprites: Georgette Jelly ($111), Jelly Goo ($112),
;#                            Harry Hedgehog ($085), Gusty ($0E6), Watermelon Seed ($107),
;#                            Boo Guy on Pulley ($10D)
;#   $01:AF6E-$01:C097    -- Level-mode setup, gamemode $0C/$0D/$10 (fade-in / pipe-door / victory cutscene)
;#                            and score-screen tilemap data
;#   $01:C098-$01:C453    -- Screen-shake offset tables and gamemode $0F dispatcher (in-level main loop)
;#   $01:C454-$01:CA3C    -- Palette-animation ptr table + animation runtime
;#   $01:CA3D-$01:D572    -- Pause menu (state machine, tilemap generation, score/star/coin/flower writeout)
;#   $01:D573-$01:D915    -- Per-level BG3 gradient HDMA setup + 7-channel HDMA init blocks
;#   $01:D916-$01:DBD4    -- Per-tile-mode offset routines (fuzzied / moving platforms / item handlers)
;#   $01:DBD5-$01:DE53    -- Pause item menu (arrows, item-box tilemap + animation)
;#   $01:DE54-$01:E26C    -- Message-box handler + state ptrs + tilemap data
;#   $01:E26D-$01:E710    -- Gamemodes $31/$33/$35/$3B/$3D/$36 (score-screen fade, retry screen, midring restart)
;#   $01:E711-$01:EC77    -- BG2/BG3 tilemap loaders + tilemap tables
;#   $01:EC78-$01:ED96    -- BG3 special routine + HDMA setups (wavy mist, sun, clouds, transparency)
;#   $01:EDB0-$01:FFFF    -- Garbage/freespace tail (V1.0: filled; V1.1/U2: inserted GarbageData)
;#
;# Cross-references:
;#   Raidenthequick bank01.asm -- best descriptive labels (init_hookbill, CODE_hookbill_dive_land_3,
;#                                CODE_hookbill_egg_hit_final_wobble, CODE_main_pause, hdma_channel_6_init, ...).
;#                                ~240 named labels in this bank (28.3 percent descriptive coverage).
;#   docs/named_main_labels.txt -- index of those names
;#   docs/enginecore.md         -- gamemode dispatcher, DATA_game_mode_pointers table, fade routines
;#   docs/bossengine.md  -- standalone Hookbill / closer / gm$0F deep dive
;#   ys_koopa.asm              -- Hookbill ("Koopa") state-machine reference (Init/Main + ~50 states)
;#   ys_boss1.asm, ys_boss2.asm -- general boss state-machine conventions (parallel to Hookbill's
;#                                $76,x / $18,x dispatch)
;#   ys_play.asm               -- player-state transitions invoked by boss handlers (e.g. the
;#                                bounce-off-head response, the egg-hit recoil)
;#   ys_game.asm               -- gamemode/levelmode dispatcher (mirrors the framework's gm$0F
;#                                per-frame in-level pipeline)
;#
;# Naming convention used below:
;#   Each templated `YI_NorSpr*_Init/Main` and anonymous `CODE_/DATA_xxxxxx` label is kept
;#   as-is for tooling. Descriptive aliases (Raidenthequick names, lowercase_with_underscores)
;#   are added at the SAME address (asar allows multiple labels per address).
;#############################################################################################################

macro YIBank01Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;-------------------------------------------------------------------------
; Stub at $01:8000. Referenced as the 4th entry (state 06) of the Boo Guy
; pulley state table (DATA_01AE89). Doing TYX/RTS effectively means "leave
; X = Y on return"; for the pulley state machine this is a no-op slot.
;
; INPUTS:   X, Y (live, untouched by caller of the stub)
; OUTPUTS:  X = Y (no other registers touched)
; MODIFIES: X
; CALLERS:  DATA_01AE89[3] (Boo-Guy pulley state $06)
;-------------------------------------------------------------------------
CODE_018000:
CODE_unused_8000_stub:                       ; cross-ref: DATA_01AE89[3] = CODE_unused_8000_stub
	TYX
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; HOOKBILL THE KOOPA (sprite $0AE) -- World 4-8 castle boss.
; Raidenthequick: init_hookbill / main_hookbill / DATA_hookbill_state_ptr / ...
; See also: ys_koopa.asm (the per-state handlers and their semantic intent).
; Deep dive: docs/bossengine.md sections 2 + 3 (state diagram, HP/damage).
;
; Two-stage state machine:
;   Phase 1 (Init): pre-fight cinematic (fog opens, graphics decompress,
;     Kamek arrives, grows the shell). 8-state dispatch via DATA_hookbill_init_state_ptr.
;   Phase 2 (Main): combat loop. Per-frame dispatch through DATA_hookbill_state_ptr
;     (DATA_hookbill_state_ptr) -- ~50 states for crawl/walk, head/shell spit,
;     egg-hit reaction, dive, turnaround, ground pound, death.
;
; State variable: $18,x (NorSpr wildcard 4, doubled into state index).
;=========================================================================

;-------------------------------------------------------------------------
; Hookbill Init.
; Loads state $18,x -> table DATA_hookbill_init_state_ptr, then sets sprite-state = 2
; (active) and snapshots BG1 X-scroll for the camera-pin during fog.
;
; INPUTS:    M=$20 X=$20 (16-bit A and X)
;            X (CPU reg) = sprite slot offset (sprite-table base index)
;            $18,x = Hookbill init-state byte ($00 / $02 / ... / $0E)
; OUTPUTS:   $7E18 = !RAM_YI_Global_Layer1XPosLo (camera-pin snapshot)
;            !EXRAM_YI_Level_NorSpr_CurrentStatus|EXRAMBankMirror,x = $0002 (active)
; MODIFIES:  A, X, Y, $7E18 plus all state set by per-init handler
; CALLERS:   Sprite Init dispatcher (Bank03 / Bank05 sprite-spawn pipeline)
;            via NormalSpriteIDs.asm entry for sprite $0AE.
;-------------------------------------------------------------------------
YI_NorSpr0AE_HookbillTheKoopa_Init:
init_hookbill:                          ; Raidenthequick: init_hookbill
;$018002
	LDY.b $18,x                         ; \ state index (byte -> word via TYX)
	TYX                                 ; /
	JSR.w (DATA_hookbill_init_state_ptr,x)               ; dispatch to one of the 8 fog/init states
	LDA.w !RAM_YI_Global_Layer1XPosLo   ; \ pin camera left boundary to current BG1 X
	STA.w $7E18                         ; /
	LDA.w #$0002                        ; \ NorSpr state = 2 (active)
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x  ; /
	RTL

;-------------------------------------------------------------------------
; Hookbill init-phase state table (8 entries, dispatched by Init above).
; Indexed by $18,x (doubled). Comments per state from Raidenthequick.
;-------------------------------------------------------------------------
DATA_018015:
DATA_hookbill_init_state_ptr:                ; Raidenthequick equivalent: hookbill init state table
	dw CODE_hookbill_init_fog                      ; 00 = start fog sequence            (CODE_hookbill_init_fog)
	dw CODE_hookbill_init_fog_left                      ; 02 = fog moves left covering screen (CODE_hookbill_init_fog_left)
	dw CODE_hookbill_init_fog_stay                      ; 04 = stays foggy for a time         (CODE_hookbill_init_fog_stay)
	dw CODE_hookbill_init_fog_fade                      ; 06 = fog fades away                 (CODE_hookbill_init_fog_fade)
	dw CODE_hookbill_init_graphics                      ; 08 = graphics loading               (CODE_hookbill_init_graphics)
	dw CODE_hookbill_init_graphics_2                      ; 0A = more graphics loading          (CODE_hookbill_init_graphics_2)
	dw CODE_hookbill_init_sprites                      ; 0C = prep sprites (Kamek etc.)      (CODE_hookbill_init_sprites)
	dw CODE_hookbill_init_boss                      ; 0E = init the boss sprite itself    (CODE_hookbill_init_boss)

;-------------------------------------------------------------------------
; Init state $02: start fog sequence. Clears BG3 X/Y, sets TM=$1304
; (BG3 + BG1 on main), enables color-math (subtract) for fog overlay.
;
; INPUTS:    M=$20 X=$20; $12 = sprite slot index
; OUTPUTS:   $6098/!RAM_Layer3XPos/$60A0/!RAM_Layer3YPos = 0 (BG3 origin)
;            !RAM_YI_Global_MainScreenLayers = $1304 (BG1+BG3 main, sprites off)
;            !RAM_YI_Global_ColorMathSelectAndEnable = $24 (color-math subtract)
;            $18,x advanced by 2 (via JMP CODE_hookbill_init_advance tail)
; MODIFIES:  A, Y, X (X reloaded from $12)
; CALLERS:   DATA_hookbill_init_state_ptr[0] (DATA_hookbill_init_state_ptr) via Hookbill Init.
;-------------------------------------------------------------------------
CODE_018025:
CODE_hookbill_init_fog:                      ; Raidenthequick: CODE_hookbill_init_fog
	LDX.b $12
CODE_018027:
	STZ.w $6098
	STZ.w !RAM_YI_Global_Layer3XPosLo
	STZ.w $60A0
	STZ.w !RAM_YI_Global_Layer3YPosLo
	LDA.w #$1304
	STA.w !RAM_YI_Global_MainScreenLayers
	LDY.b #$24
	STY.w !RAM_YI_Global_ColorMathSelectAndEnable
	JMP.w CODE_hookbill_init_advance

;-------------------------------------------------------------------------
; Init state $02 (entered as $18,x = $02): fog sweeps in left-to-right.
; Each frame advances the fog column count, runs two SuperFX routines:
;   FXCODE_08AA7F: paints fog column data into scratch RAM
;   FXCODE_089208: advances fog density / parameters
; When $7680,x (sprite X) -> $0120 boundary is crossed, the column count
; resets and the BG3 column is committed via CODE_queue_dma_4args DMA helper.
;
; INPUTS:    M=$20 X=$20; $12 = sprite slot
;            $7A96,x = fog-column timer (0 = fully covered)
;            $7680,x = Hookbill BG-relative X (camera anchor)
; OUTPUTS:   $60A0/!RAM_Layer3YPosLo = current Y scroll
;            $6098/!RAM_Layer3XPosLo = current X scroll
;            !RAM_YI_Global_HDMAEnable bit 3 ($08) = set (fog HDMA on)
;            BG3 indirect-source at $7E:51E4 populated by CODE_queue_dma_4args
; MODIFIES:  A, X (reloaded from $12), Y, SuperFX R1/R2/R3/R4/R5/R6/R12
; CALLERS:   DATA_hookbill_init_state_ptr[1] (DATA_hookbill_init_state_ptr).
;-------------------------------------------------------------------------
CODE_018041:
CODE_hookbill_init_fog_left:
	LDX.b $12
	LDA.w $7A96,x
	BNE.b CODE_018051
	LDA.w #$0004
	STA.w $7A96,x
	DEC.w $70E2,x
CODE_018051:
	REP.b #$10
	LDY.w #$0000
	LDA.w $7680,x
	SEC
	SBC.w #$0120
	EOR.w #$FFFF
	INC
	BPL.b CODE_018066
	LDA.w #$0000
CODE_018066:
	CMP.w #$00E0
	BCC.b CODE_0180B9
	LDY.w #$0100
	SBC.w #$00E0
	CMP.w #$00E0
	BCC.b CODE_0180B9
	PHY
	LDA.w #$2000
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$2F6C
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0200
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	SEP.b #$10
	LDX.b #FXCODE_08AA7F>>16
	LDA.w #FXCODE_08AA7F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$7FFF
	STA.l $702F8C
	LDX.b #$1C
CODE_01809D:
	STA.l $70302E,x
	STA.l $70304E,x
	DEX
	DEX
	BPL.b CODE_01809D
	LDA.w #$0000
	STA.l $70336C
	JSR.w CODE_hookbill_init_advance
	REP.b #$10
	PLY
	LDA.w #$00E0
CODE_0180B9:
	STY.w $60A0
	STY.w !RAM_YI_Global_Layer3YPosLo
	STA.w $6098
	STA.w !RAM_YI_Global_Layer3XPosLo
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.b $14
	LSR
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0070
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$000F
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	STZ.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$36BA
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	SEP.b #$10
	LDX.b #FXCODE_089208>>16
	LDA.w #FXCODE_089208
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	JSL.l CODE_queue_dma_4args	: dl $7E51E4,$7036BA : dw $0348
	LDA.w #$0008
	TSB.w !RAM_YI_Global_HDMAEnable
	LDX.b $12
	RTS

;-------------------------------------------------------------------------
; Init state $04: fog stays opaque while Hookbill graphics decompress.
; Every 8 frames runs FXCODE_08B4A9 (fog hold). When $7E:336C >= $20
; (fog-density accumulator), advances state to fade.
;
; INPUTS:    $14 = frame counter low; $7E:336C = fog accumulator (live)
; OUTPUTS:   $0948 = palette mirror byte (BG2 row 10)
; MODIFIES:  A, X, Y, SuperFX R0/R12
; CALLERS:   DATA_hookbill_init_state_ptr[2] (DATA_hookbill_init_state_ptr).
;-------------------------------------------------------------------------
CODE_018103:
CODE_hookbill_init_fog_stay:
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_018131
	LDA.l $70336C
	CMP.w #$0020
	BCS.b CODE_018134
CODE_018113:
	LDA.w #$2D6C
	STA.l $70336E
	LDA.w #$2F6C
	STA.l $703370
	LDX.b #FXCODE_08B4A9>>16
	LDA.w #FXCODE_08B4A9
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.l YI_Global_PaletteMirror[$10].LowByte
	STA.w $0948
CODE_018131:
	LDX.b $12
	RTS

CODE_018134:
	LDA.w #$0008
	TRB.w !RAM_YI_Global_HDMAEnable
	LDA.w #$0002
	TRB.w !RAM_YI_Global_SubScreenLayers
	LDA.w #$0000
	STA.l $702F6E
	STA.l $702F70
	STA.l $702F72
	STA.l $70336C
	LDX.b #$1C
CODE_018155:
	LDA.l DATA_5FDABE+$02,x
	STA.l $70314E,x
	DEX
	DEX
	BPL.b CODE_018155
	LDA.l DATA_5FDABE
	STA.l $70314C
	JSR.w CODE_hookbill_init_advance
	LDA.w #$00D5
	JSL.l CODE_spawn_sprite_init
	RTS

;-------------------------------------------------------------------------
; Init state $06: fog fades out. Clears HDMA bit 3, SubScreen bit 1,
; resets fog SuperFX scratch RAM, then advances $18,x via CODE_hookbill_init_advance.
;
; INPUTS:    $14 = frame counter low; $7E:336C = fog accumulator
; OUTPUTS:   !RAM_YI_Global_HDMAEnable bit 3 ($08) cleared
;            !RAM_YI_Global_SubScreenLayers bit 1 ($02) cleared
;            !RAM_YI_Level_LevelHeaderAnimationTilesetLo = $04
;            !RAM_YI_Level_LevelHeaderAnimationPaletteLo = $00
;            $0C14 / $0C16 / $0D2B / $0D3B = 0
;            $18,x advanced by 2 via CODE_hookbill_init_advance tail
; MODIFIES:  A, X, Y
; CALLERS:   DATA_hookbill_init_state_ptr[3] (DATA_hookbill_init_state_ptr).
;-------------------------------------------------------------------------
CODE_018174:
CODE_hookbill_init_fog_fade:
	LDA.b $14
	AND.w #$0007
	BNE.b CODE_018131
	LDA.l $70336C
	CMP.w #$0020
	BCC.b CODE_018113
	LDX.b $12
	JSL.l CODE_03D5E4
	STZ.w $0C14
	STZ.w $0C16
	LDA.w #$0004
	STA.w !RAM_YI_Level_LevelHeaderAnimationTilesetLo
	STZ.w !RAM_YI_Level_LevelHeaderAnimationPaletteLo
	STZ.w $0D2B
	STZ.w $0D3B
;-------------------------------------------------------------------------
; CODE_hookbill_init_advance: shared tail for init handlers -- advance $18,x to next
; init state (each entry is 2 bytes wide in DATA_hookbill_init_state_ptr).
;-------------------------------------------------------------------------
CODE_01819F:
CODE_hookbill_init_advance:
	SEP.b #$10
	LDX.b $12
	INC.b $18,x
	INC.b $18,x
	RTS

;-------------------------------------------------------------------------
; Init state $08: decompress Hookbill graphics tile blob 1.
; Loads compressed-graphic ID $4D into VRAM page $2800.
;
; INPUTS:    None (uses fixed gfx ID + VRAM target)
; OUTPUTS:   VRAM $2800..$2BFF = Hookbill body tiles part 1
;            !RAM_YI_Global_MainScreenLayers cleared bits 2+10 ($0404)
; MODIFIES:  A, X, Y
; CALLERS:   DATA_hookbill_init_state_ptr[4] (DATA_hookbill_init_state_ptr).
;-------------------------------------------------------------------------
CODE_0181A8:
CODE_hookbill_init_graphics:
	LDA.w #$004D
	REP.b #$10
	LDY.w #$2800
	BRA.b CODE_0181BA

;-------------------------------------------------------------------------
; Init state $0A: decompress Hookbill graphics tile blob 2.
; Loads compressed-graphic ID $4E into VRAM page $2C00.
;
; INPUTS:    None (uses fixed gfx ID + VRAM target)
; OUTPUTS:   VRAM $2C00..$2FFF = Hookbill body tiles part 2
; MODIFIES:  A, X, Y
; CALLERS:   DATA_hookbill_init_state_ptr[5] (DATA_hookbill_init_state_ptr).
;-------------------------------------------------------------------------
CODE_0181B2:
CODE_hookbill_init_graphics_2:
	LDA.w #$004E
	REP.b #$10
	LDY.w #$2C00
CODE_0181BA:
	JSR.w CODE_hookbill_decompress_gfx
	LDA.w #$0404
	TRB.w !RAM_YI_Global_MainScreenLayers
	BRA.b CODE_hookbill_init_advance

;-------------------------------------------------------------------------
; Init state $0C: spawn Kamek + ancillary sprites for the boss intro.
;   - JSL CODE_0181FB: decompresses palette gfx $F8 into VRAM $3400 and
;     populates palette mirror rows.
;   - Queues music fade (!Define_YI_MusicID_FadeMusicCommand) and the
;     boss-intro "magic" Kamek (sprite $DD via CODE_spawn_sprite_active).
;   - Plays sound $48 (boss-music intro).
;   - Sets up the Kamek's $701978 / $701902 extension words and
;     initial X velocity in $70E2,y.
;   - Spawns the Kamek "magic flash" effect via CODE_04F74A.
;
; INPUTS:    Sprite slot index in X (live)
; OUTPUTS:   Y = newly-spawned Kamek slot
;            Kamek slot's $7A36,y / $701902,y / $701978,y / $70E2,y / $105A / $0B7B initialized
;            Music = queued fade
;            $18,x advanced by 2 via CODE_hookbill_init_advance tail
; MODIFIES:  A, X, Y
; CALLERS:   DATA_hookbill_init_state_ptr[6] (DATA_hookbill_init_state_ptr).
;-------------------------------------------------------------------------
CODE_0181C5:
CODE_hookbill_init_sprites:
	JSL.l CODE_0181FB
	LDA.w #!Define_YI_MusicID_FadeMusicCommand
	STA.w !RAM_YI_Global_PlayMusicLo
	LDA.w #$00DD
	JSL.l CODE_spawn_sprite_active
	LDA.w #$0042
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
	LDA.w #$0074
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,y
	STZ.w $105A
	INC.w $0B7B
	LDA.w #$0048
	JSL.l CODE_spawn_sprite_init
	LDA.w #$0010
	STA.w $70E2,y
	JSL.l CODE_04F74A
	BRA.b CODE_hookbill_init_advance

CODE_0181FB:
	REP.b #$10
	LDA.w #$00F8
	LDY.w #$3400
	JSR.w CODE_hookbill_decompress_gfx
	LDX.b #$0C
CODE_018208:
	LDA.l DATA_5FC13A,x
	STA.l $702D7E,x
	STA.l YI_Global_PaletteMirror[$09].LowByte,x
	STA.l $702F7E,x
	DEX
	DEX
	BPL.b CODE_018208
	RTL

;-------------------------------------------------------------------------
; CODE_hookbill_decompress_gfx: shared helper -- decompress a graphics blob and DMA it to
; VRAM. Used by CODE_hookbill_init_graphics, CODE_hookbill_init_graphics_2, and
; CODE_0181FB (palette gfx).
;
; INPUTS:    A = compressed-graphic ID; Y = VRAM destination word
; OUTPUTS:   Compressed data decompressed at $70:6800 and DMA'd to Y
; MODIFIES:  A, X, Y, $0001 (DMA source-bank scratch)
;-------------------------------------------------------------------------
CODE_01821D:
CODE_hookbill_decompress_gfx:
	PHY
	LDX.w #$6800
	JSL.l CODE_00B756
	PLY
	LDX.w #$706800>>16
	STX.w $0001
	LDX.w #$706800
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
CODE_018235:
	RTS

;-------------------------------------------------------------------------
; Init state $0E: spawn Hookbill himself (the actual boss sprite goes
; "active" and gets a starting position / facing / state).
; Final init step -- the PLA / RTL at the end consumes the parent
; dispatcher's return address, terminating the call chain so the boss
; immediately runs Main on the next frame.
;
; INPUTS:    Sprite slot X (live); $12 = slot; $105A = Kamek-spawn flag
; OUTPUTS:   Hookbill position:
;              $70E2,x = Layer1XPos + $0120 (1.5 screens right of camera)
;              $7182,x = player Y (matched to player)
;              $7E18 = Layer1XPos (camera-left-edge pin)
;              $7E1A = Layer1XPos + $0100 (camera-right-edge pin)
;              $1082 = right-edge pin (mirrored)
;            Velocities / acceleration / scale:
;              $7542,x = $0040 (initial X-speed)
;              $75E2,x = $0400 (Y gravity)
;              $106E = $0400, $74A2,x = $04 (high byte XBA)
;              EXRAM XSpeed = $FF80 (moving left)
;            !RAM_YI_Global_MainScreenLayers = $0015 (BG1+sprites+BG3)
;            !RAM_YI_Global_PlayMusicLo = $0009 (Hookbill boss music)
;            $76,x = $2B (initial state byte before doubling)
; MODIFIES:  A, X (reloaded), Y, then PLA + RTL terminates dispatcher.
; CALLERS:   DATA_hookbill_init_state_ptr[7] (DATA_hookbill_init_state_ptr) -- LAST init step.
;-------------------------------------------------------------------------
CODE_018236:
CODE_hookbill_init_boss:
	LDX.b $12
	STZ.w $60C4
	LDY.w $105A
	BEQ.b CODE_018235
	STZ.w $7ECC
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w #$0120
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w $7182,x
	STZ.w $0C1E
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $7E18
	CLC
	ADC.w #$0100
	STA.w $1082
	STA.w $7E1A
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	STA.w $106E
	XBA
	STA.w $74A2,x
	LDA.w #$FF80
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $1080
	STZ.w $60A0
	LDA.w #$0015
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w #!Define_YI_MusicID09_BossBattle
	STA.w !RAM_YI_Global_PlayMusicLo
	LDY.b #$2B
	STY.b $76,x
	PLA
	RTL

;---------------------------------------------------------------------------

DATA_018297:
	db $02,$DF,$14,$B9,$06,$00,$B4,$0E,$D8,$09,$00,$FF,$20,$DF,$07,$00
	db $90,$16,$7A,$0C,$01,$9B,$15,$BC,$07,$00,$EA,$1A,$D3,$08,$00,$F3
	db $06,$00,$00,$02,$E5,$17,$B9,$06,$00,$A4,$0C,$D9,$08,$00,$FD,$1F
	db $E2,$07,$00,$8A,$15,$79,$0C,$01,$A0,$13,$B9,$07,$00,$EC,$14,$D7
	db $08,$00,$02,$06,$00,$00,$02,$E8,$1A,$BC,$06,$01,$A2,$0C,$B0,$08
	db $00,$FC,$1E,$E1,$07,$00,$85,$14,$7B,$0D,$01,$A6,$10,$BD,$07,$02
	db $F0,$14,$B6,$06,$00,$0C,$06,$00,$00,$02,$EC,$1D,$BA,$06,$02,$A4
	db $0C,$AD,$06,$00,$FC,$1D,$DD,$07,$00,$89,$17,$7A,$0C,$01,$B0,$0E
	db $B9,$07,$01,$EF,$14,$AF,$09,$00,$02,$06,$00,$00,$00,$EC,$1D,$D5
	db $07,$01,$9F,$13,$B8,$07,$00,$FB,$1C,$E1,$07,$00,$8E,$17,$7A,$0C
	db $00,$AE,$0E,$D4,$08,$02,$DE,$12,$BB,$06,$00,$F3,$06,$00,$00,$00
	db $EF,$18,$D0,$07,$01,$A5,$11,$BC,$07,$00,$FC,$1D,$E3,$07,$00,$89
	db $17,$79,$0C,$01,$9E,$0E,$CC,$07,$02,$E1,$15,$B4,$05,$00,$02,$06
	db $00,$00,$02,$F2,$17,$BA,$06,$01,$AF,$0E,$B9,$07,$00,$FC,$1E,$DE
	db $07,$00,$84,$15,$79,$0C,$01,$9C,$0B,$BC,$07,$02,$E6,$18,$BA,$06
	db $00,$0C,$06,$00,$00,$01,$F0,$18,$A8,$08,$01,$B9,$0D,$BC,$07,$00
	db $FD,$1F,$DF,$07,$00,$8A,$15,$79,$0C,$02,$9D,$0E,$AF,$08,$02,$EA
	db $1B,$B7,$06,$00,$02,$06,$00,$00,$02,$AD,$0E,$BA,$07,$03,$63,$0F
	db $B2,$06,$00,$E2,$0F,$DF,$08,$00,$57,$1C,$78,$0C,$05,$76,$14,$A6
	db $09,$00,$C9,$0E,$D5,$07,$00,$24,$07,$00,$00,$02,$B9,$0D,$BA,$07
	db $04,$64,$0E,$AA,$08,$00,$E1,$10,$E0,$08,$00,$53,$1D,$78,$0C,$04
	db $73,$13,$A9,$08,$00,$BC,$0A,$D2,$07,$00,$27,$09,$00,$00,$02,$C5
	db $0D,$B7,$07,$04,$6D,$0F,$AB,$08,$00,$E4,$11,$E0,$09,$00,$50,$1E
	db $78,$0C,$04,$70,$11,$AA,$08,$02,$BC,$07,$BC,$07,$00,$2A,$0B,$00
	db $00,$02,$D1,$0E,$BB,$07,$05,$6D,$0F,$A5,$0A,$00,$E6,$12,$E1,$08
	db $00,$53,$1D,$7A,$0C,$03,$6F,$13,$BB,$07,$01,$B9,$04,$AA,$09,$00
	db $27,$09,$00,$00,$00,$D0,$0F,$D4,$07,$05,$70,$10,$A6,$0A,$00,$E8
	db $12,$E1,$08,$00,$57,$1C,$7A,$0C,$03,$6A,$11,$B8,$07,$02,$A8,$10
	db $B9,$07,$00,$24,$07,$00,$00,$00,$CA,$0A,$D4,$07,$04,$70,$10,$AB
	db $08,$00,$E6,$12,$DF,$08,$00,$53,$1D,$79,$0C,$04,$6C,$10,$AA,$08
	db $02,$B2,$0E,$BB,$07,$00,$27,$09,$00,$00,$02,$CE,$07,$B9,$07,$04
	db $6B,$0F,$AB,$08,$00,$E4,$11,$E1,$08,$00,$4F,$1E,$78,$0C,$04,$70
	db $11,$A8,$08,$02,$BC,$0D,$BB,$07,$00,$2A,$0B,$00,$00,$01,$DD,$05
	db $A6,$0A,$03,$6B,$0F,$B2,$06,$00,$E1,$10,$E1,$08,$00,$53,$1D,$79
	db $0C,$05,$72,$12,$A8,$09,$02,$CB,$0D,$BC,$07,$00,$27,$09,$00,$00
	db $01,$C7,$10,$A5,$0A,$05,$B8,$0A,$A6,$0A,$00,$F4,$1C,$D7,$07,$00
	db $6E,$15,$78,$0C,$03,$81,$0F,$B3,$06,$00,$E9,$1B,$D2,$07,$00,$13
	db $07,$00,$00,$02,$CE,$12,$B8,$07,$04,$A5,$0A,$AD,$08,$00,$F2,$1B
	db $D6,$07,$00,$6D,$15,$7A,$0C,$04,$87,$0C,$AC,$08,$00,$E8,$12,$D3
	db $07,$00,$14,$09,$00,$00,$02,$DD,$16,$BA,$07,$04,$98,$09,$AC,$08
	db $00,$EF,$19,$D9,$07,$00,$69,$14,$7A,$0C,$04,$92,$0B,$A9,$08,$02
	db $E0,$10,$BA,$07,$00,$13,$0B,$00,$00,$00,$E1,$19,$D0,$08,$03,$89
	db $0C,$B5,$06,$00,$ED,$17,$D7,$07,$00,$65,$14,$78,$0C,$05,$A3,$09
	db $A8,$0A,$01,$D8,$0E,$A4,$0A,$00,$13,$0D,$00,$00,$00,$ED,$1D,$D1
	db $08,$03,$92,$0F,$B5,$06,$00,$EF,$15,$D6,$07,$00,$6F,$15,$78,$0C
	db $05,$AD,$0B,$A5,$0A,$01,$C0,$10,$A7,$0A,$00,$13,$07,$00,$00,$00
	db $EC,$14,$D1,$08,$04,$89,$09,$A8,$08,$00,$ED,$17,$DA,$07,$00,$6B
	db $15,$79,$0C,$04,$9D,$0C,$AA,$08,$02,$C8,$11,$BD,$07,$00,$14,$09
	db $00,$00,$02,$E9,$10,$BA,$07,$04,$98,$09,$AB,$08,$00,$F0,$19,$D6
	db $07,$00,$68,$14,$79,$0C,$04,$93,$0B,$A9,$08,$02,$D7,$14,$BD,$07
	db $00,$13,$0B,$00,$00,$01,$DE,$10,$A4,$0A,$05,$B1,$07,$A7,$0A,$00
	db $F2,$1B,$D7,$07,$00,$66,$14,$7A,$0C,$03,$88,$0F,$B3,$06,$00,$DC
	db $17,$D1,$07,$00,$13,$0D,$00,$00,$02,$C0,$0C,$00,$00,$05,$60,$08
	db $00,$00,$00,$80,$08,$00,$00,$00,$00,$00,$00,$00,$05,$60,$08,$00
	db $00,$02,$C0,$0C,$00,$00,$00,$00,$00,$00,$00,$02,$00,$00,$00,$00
	db $05,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$80,$05,$00,$00,$05
	db $00,$00,$00,$00,$02,$00,$00,$00,$00,$00,$00,$00,$00,$00,$02,$F2
	db $24,$00,$00,$05,$8C,$24,$00,$00,$00,$0C,$22,$00,$00,$00,$84,$2B
	db $00,$00,$05,$86,$15,$00,$00,$02,$01,$22,$00,$00,$00,$00,$00,$00
	db $00,$02,$FC,$22,$00,$00,$05,$8B,$1E,$00,$00,$00,$04,$1B,$00,$00
	db $00,$83,$28,$00,$00,$05,$87,$24,$00,$00,$02,$01,$21,$00,$00,$00
	db $00,$00,$00,$00,$02,$06,$22,$00,$00,$05,$8A,$23,$00,$00,$00,$14
	db $22,$00,$00,$00,$82,$27,$00,$00,$05,$84,$20,$00,$00,$02,$0F,$1D
	db $00,$00,$00,$00,$00,$00,$00,$02,$BD,$1F,$B9,$04,$05,$64,$1F,$43
	db $05,$00,$CE,$20,$B4,$00,$00,$53,$28,$2A,$06,$05,$5A,$21,$50,$09
	db $01,$9A,$20,$C6,$03,$00,$00,$00,$00,$00,$02,$BD,$1F,$A8,$04,$05
	db $64,$1F,$9D,$05,$00,$CE,$20,$01,$04,$00,$53,$28,$1A,$08,$05,$5A
	db $21,$BF,$09,$01,$9A,$20,$BF,$06,$00,$00,$00,$00,$00,$02,$AF,$23
	db $9A,$04,$05,$54,$20,$37,$05,$00,$C3,$1D,$D2,$04,$00,$40,$28,$3E
	db $02,$05,$4C,$22,$4E,$07,$01,$9B,$23,$64,$07,$00,$00,$00,$00,$00
	db $02,$AF,$23,$6B,$03,$05,$54,$20,$90,$08,$00,$C3,$1D,$99,$04,$00
	db $40,$28,$F7,$04,$05,$4C,$22,$93,$08,$01,$9B,$23,$60,$0A,$00,$00
	db $00,$00,$00,$02,$75,$23,$4F,$04,$05,$0D,$1D,$17,$06,$00,$7B,$22
	db $98,$04,$00,$0A,$22,$07,$03,$05,$11,$20,$1B,$08,$02,$6B,$1C,$50
	db $0B,$00,$00,$00,$00,$00,$02,$75,$23,$A9,$04,$05,$0D,$1D,$EC,$0A
	db $00,$7B,$22,$C0,$0A,$00,$0A,$22,$EB,$08,$05,$11,$20,$F0,$08,$02
	db $6B,$1C,$AB,$0A,$00,$00,$00,$00,$00,$02,$5F,$1B,$29,$08,$05,$F6
	db $23,$F7,$04,$00,$65,$1A,$73,$07,$00,$EF,$21,$16,$07,$05,$F5,$25
	db $35,$07,$02,$4E,$1A,$3E,$04,$00,$00,$00,$00,$00,$02,$67,$1D,$3B
	db $04,$05,$16,$1D,$3C,$07,$00,$77,$1D,$5F,$04,$00,$16,$25,$5D,$04
	db $05,$12,$1E,$3C,$07,$02,$58,$1D,$74,$04,$00,$00,$00,$00,$00,$02
	db $00,$00,$00,$00,$05,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$05,$00,$00,$00,$00,$02,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$02,$C0,$0C,$00,$00,$05,$60,$08,$00,$00,$00,$80,$08,$00
	db $00,$00,$00,$00,$00,$00,$05,$60,$08,$00,$00,$02,$C0,$0C,$00,$00
	db $00,$00,$00,$00,$00,$02,$80,$08,$00,$00,$05,$80,$08,$00,$00,$00
	db $00,$00,$00,$00,$00,$80,$08,$00,$00,$05,$80,$08,$00,$00,$02,$80
	db $08,$00,$00,$00,$00,$00,$00,$00,$02,$DF,$14,$B9,$06,$00,$B4,$0E
	db $D8,$09,$00,$F2,$20,$DF,$07,$00,$A0,$16,$7A,$0C,$01,$9B,$15,$BC
	db $07,$00,$EA,$1A,$D3,$08,$00,$E0,$08,$00,$00,$02,$E5,$17,$B9,$06
	db $00,$A4,$0C,$D9,$08,$00,$F0,$1F,$E2,$07,$00,$9A,$15,$79,$0C,$01
	db $A0,$13,$B9,$07,$00,$EC,$14,$D7,$08,$00,$EF,$08,$00,$00,$02,$E8
	db $1A,$BC,$06,$01,$A2,$0C,$B0,$08,$00,$EF,$1E,$E1,$07,$00,$95,$14
	db $7B,$0D,$01,$A6,$10,$BD,$07,$02,$F0,$14,$B6,$06,$00,$F9,$08,$00
	db $00,$02,$EC,$1D,$BA,$06,$02,$A4,$0C,$AD,$06,$00,$EF,$1D,$DD,$07
	db $00,$99,$17,$7A,$0C,$01,$B0,$0E,$B9,$07,$01,$EF,$14,$AF,$09,$00
	db $EF,$08,$00,$00,$00,$EC,$1D,$D5,$07,$01,$9F,$13,$B8,$07,$00,$EE
	db $1C,$E1,$07,$00,$9E,$17,$7A,$0C,$00,$AE,$0E,$D4,$08,$02,$DE,$12
	db $BB,$06,$00,$E0,$08,$00,$00,$00,$EF,$18,$D0,$07,$01,$A5,$11,$BC
	db $07,$00,$EF,$1D,$E3,$07,$00,$99,$17,$79,$0C,$01,$9E,$0E,$CC,$07
	db $02,$E1,$15,$B4,$05,$00,$EF,$08,$00,$00,$02,$F2,$17,$BA,$06,$01
	db $AF,$0E,$B9,$07,$00,$EF,$1E,$DE,$07,$00,$94,$15,$79,$0C,$01,$9C
	db $0B,$BC,$07,$02,$E6,$18,$BA,$06,$00,$F9,$08,$00,$00,$01,$F0,$18
	db $A8,$08,$01,$B9,$0D,$BC,$07,$00,$F0,$1F,$DF,$07,$00,$9A,$15,$79
	db $0C,$02,$9D,$0E,$AF,$08,$02,$EA,$1B,$B7,$06,$00,$EF,$08,$00,$00

DATA_018927:
	db $00,$00,$00,$00,$F6,$00,$00,$00,$00,$D5,$00,$00,$00,$00,$EC,$C0
	db $40,$C0,$20,$00,$95,$15,$95,$20,$D5,$60,$F0,$40,$E0,$00,$70,$E0
	db $00,$10,$00,$60,$D0,$40,$E8,$0C,$00,$A0,$00,$C0,$C8,$FC,$E0,$10
	db $C0,$C4,$00,$A0,$00,$B0,$B0,$F0,$C0,$10,$B0,$A8,$AC,$5C,$AC,$7C
	db $7C,$E4,$54,$C4,$64,$84,$78,$50,$70,$88,$70,$88,$80,$80,$98,$80
	db $40,$C0,$40,$A0,$80,$30,$B0,$30,$90,$70,$C0,$40,$A0,$60,$00,$00
	db $00,$00,$00,$E0,$00,$00,$00,$00,$20,$40,$C0,$40,$D0,$80,$00,$00
	db $00,$00,$80,$00,$00,$00,$10,$F6,$00,$00,$04,$10,$F6

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Hookbill combat-phase state table (~55 entries; some indices share
; targets). Dispatched per-frame by Main (below) via state byte $76,x.
; Names from Raidenthequick.
;-------------------------------------------------------------------------
DATA_0189A4:
DATA_hookbill_state_ptr:                     ; Raidenthequick: DATA_hookbill_state_ptr
	dw CODE_hookbill_start_crawl                      ; 00 CODE_hookbill_start_crawl
	dw CODE_hookbill_crawl_forward                      ; 02 CODE_hookbill_crawl_forward
	dw CODE_hookbill_head_spit_egg                      ; 04 CODE_hookbill_head_spit_egg
	dw CODE_hookbill_head_nudge_up                      ; 06 CODE_hookbill_head_nudge_up
	dw CODE_hookbill_head_back                      ; 08 CODE_hookbill_head_back
	dw CODE_hookbill_shell_spit_egg                      ; 0A CODE_hookbill_shell_spit_egg
	dw CODE_hookbill_shell_nudge_up                      ; 0C CODE_hookbill_shell_nudge_up
	dw CODE_hookbill_head_back                      ; 0E (re-uses head_back)
	dw CODE_hookbill_stand_up                      ; 10 CODE_hookbill_stand_up
	dw CODE_hookbill_stare_forward                      ; 12 CODE_hookbill_stare_forward
	dw CODE_hookbill_stand_up                      ; 14 (re-uses stand_up)
	dw CODE_hookbill_walk_forward                      ; 16 CODE_hookbill_walk_forward
	dw CODE_hookbill_hunch_forward                      ; 18 CODE_hookbill_hunch_forward
	dw CODE_hookbill_egg_hit_while_running                      ; 1A CODE_hookbill_egg_hit_while_running
	dw CODE_hookbill_run_forward                      ; 1C CODE_hookbill_run_forward
	dw CODE_hookbill_dive                      ; 1E CODE_hookbill_dive
	dw CODE_hookbill_dive_land                      ; 20 CODE_hookbill_dive_land
	dw CODE_hookbill_dive_land_2                      ; 22 CODE_hookbill_dive_land_2
	dw CODE_hookbill_dive_land_3                      ; 24 CODE_hookbill_dive_land_3
	dw CODE_hookbill_dive_land_4                      ; 26 CODE_hookbill_dive_land_4
	dw CODE_hookbill_dive_blink                      ; 28 CODE_hookbill_dive_blink
	dw CODE_hookbill_dive_get_up                      ; 2A CODE_hookbill_dive_get_up
	dw CODE_hookbill_turnaround_retract                      ; 2C CODE_hookbill_turnaround_retract
	dw CODE_hookbill_turnaround_jump                      ; 2E CODE_hookbill_turnaround_jump
	dw CODE_hookbill_turnaround_stand_retract                      ; 30 CODE_hookbill_turnaround_stand_retract
	dw CODE_hookbill_turnaround_stand_rotate                      ; 32 CODE_hookbill_turnaround_stand_rotate
	dw CODE_hookbill_turnaround_stand_rotate                      ; 34 (re-uses stand_rotate)
	dw CODE_hookbill_turnaround_fall                      ; 36 CODE_hookbill_turnaround_fall
	dw CODE_hookbill_egg_hit_init                      ; 38 CODE_hookbill_egg_hit_init
	dw CODE_hookbill_egg_hit_cry                      ; 3A CODE_hookbill_egg_hit_cry
	dw CODE_hookbill_egg_hit_not_egged_again                      ; 3C CODE_hookbill_egg_hit_not_egged_again
	dw CODE_hookbill_egg_hit_final_init                      ; 3E CODE_hookbill_egg_hit_final_init
	dw CODE_hookbill_egg_hit_final_hop                      ; 40 CODE_hookbill_egg_hit_final_hop
	dw CODE_hookbill_egg_hit_final_fall                      ; 42 CODE_hookbill_egg_hit_final_fall
	dw CODE_hookbill_egg_hit_final_lean                      ; 44 CODE_hookbill_egg_hit_final_lean
	dw CODE_hookbill_egg_hit_final_wobble                      ; 46 CODE_hookbill_egg_hit_final_wobble
	dw CODE_hookbill_egg_hit_final_freeze                      ; 48 CODE_hookbill_egg_hit_final_freeze
	dw CODE_hookbill_hop_wobble                      ; 4A CODE_hookbill_hop_wobble
	dw CODE_hookbill_hop_one                      ; 4C CODE_hookbill_hop_one
	dw CODE_hookbill_hop_two                      ; 4E CODE_hookbill_hop_two
	dw CODE_hookbill_ground_pound_and_body_out                      ; 50 CODE_hookbill_ground_pound_and_body_out
	dw CODE_hookbill_ground_pounded_init                      ; 52 CODE_hookbill_ground_pounded_init
	dw CODE_hookbill_ground_pounded_flash                      ; 54 CODE_hookbill_ground_pounded_flash
	dw CODE_hookbill_begin_koopa_walking                      ; 56 CODE_hookbill_begin_koopa_walking
	dw CODE_hookbill_begin_kamek                      ; 58 CODE_hookbill_begin_kamek
	dw CODE_hookbill_begin_init1                      ; 5A CODE_hookbill_begin_init1
	dw CODE_hookbill_begin_init2                      ; 5C CODE_hookbill_begin_init2
	dw CODE_hookbill_begin_koopa_crouch                      ; 5E CODE_hookbill_begin_koopa_crouch
	dw CODE_hookbill_begin_shell_init                      ; 60 CODE_hookbill_begin_shell_init
	dw CODE_hookbill_begin_shell_grow                      ; 62 CODE_hookbill_begin_shell_grow
	dw CODE_hookbill_ground_pound_and_body_out                      ; 64 (re-uses ground_pound_and_body_out)
	dw CODE_hookbill_ground_pounded_init                      ; 66 (re-uses ground_pounded_init)
	dw CODE_hookbill_dead_squish_down                      ; 68 CODE_hookbill_dead_squish_down
	dw CODE_hookbill_dead_pancake                      ; 6A CODE_hookbill_dead_pancake
	dw CODE_hookbill_dead_shell_break                      ; 6C CODE_hookbill_dead_shell_break
	dw CODE_hookbill_final                      ; 6E CODE_hookbill_final

;-------------------------------------------------------------------------
; Hookbill Main (per-frame).
; Reads $1080 (player/intro counter):
;   0     -> CODE_018CD8 (idle path -- just refresh OAM during cinematic)
;   1     -> CODE_018CC7 (intro tail -- shape Kamek-throw OAM)
;   other -> normal combat path (CODE_018D1C + CODE_018A50)
; Then JSL CODE_03AF23 (shared sprite housekeeping), then dispatches
; via DATA_hookbill_state_ptr on $76,x (state byte, doubled into X).
; After the state handler returns (and only when $1080 >= 2), runs
; per-frame post-state pipeline:
;   - CODE_0191BB / 01922A : collision / hit detection
;   - CODE_018A95          : SuperFX shadow/body draw selector
;   - CODE_01924D          : palette mirror update (boss color cycle)
;   - CODE_0192DA          : camera/X-position clamp
;
; INPUTS:    M=$20 X=$20
;            X (CPU) = sprite slot index
;            $76,x  = combat-state byte
;            $1080  = boss phase (0 / 1 / >=2)
; OUTPUTS:   Slot state advanced for one frame; OAM populated;
;            Mode-7 matrix updated; palette mirror updated; collisions
;            registered against player.
; MODIFIES:  A, X, Y; per-frame ALL boss-state WRAM ($7Axxx, $76,x, ...);
;            SuperFX scratch RAM and registers; Mode-7 matrix A/B/C/D.
; CALLERS:   Bank03 sprite-list traversal (CODE_0397DF from gamemode 0F).
;-------------------------------------------------------------------------
YI_NorSpr0AE_HookbillTheKoopa_Main:
main_hookbill:                          ; Raidenthequick: main_hookbill
;$018A14
	LDY.w $1080
	BEQ.b CODE_018A24
	DEY
	BNE.b CODE_018A29
	JSR.w CODE_018D1C
	JSR.w CODE_018A50
	BRA.b CODE_018A2C

CODE_018A24:
	JSR.w CODE_018CD8
	BRA.b CODE_018A2C

CODE_018A29:
	JSR.w CODE_018CC7
CODE_018A2C:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_hookbill_state_ptr,x)
	LDY.w $1080
	BEQ.b CODE_018A4F
	DEY
	BNE.b CODE_018A4F
	JSR.w CODE_0191BB
	JSR.w CODE_01922A
	JSR.w CODE_018A95
	JSR.w CODE_01924D
	JSR.w CODE_0192DA
CODE_018A4F:
	RTL

;---------------------------------------------------------------------------

CODE_018A50:
	LDA.w $1060
	ASL
	LDY.w $7400,x
	BEQ.b CODE_018A60
	EOR.w #$FFFF
	INC
	AND.w #$01FE
CODE_018A60:
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $1076
	ASL
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $1078
	ASL
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08A000>>16
	LDA.w #FXCODE_08A000
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STA.w !RAM_YI_Global_Mode7MatrixParameterBLo
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	STA.w !RAM_YI_Global_Mode7MatrixParameterALo
	LDA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	STA.w !RAM_YI_Global_Mode7MatrixParameterCLo
	LDA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !RAM_YI_Global_Mode7MatrixParameterDLo
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

CODE_018A95:
	LDY.w $1070
	BEQ.b CODE_018AB5
	LDA.w $7974
	AND.w #$0001
	BEQ.b CODE_018AAA
	JSR.w CODE_018AC9
	JSR.w CODE_018AE1
	BRA.b CODE_018AB0

CODE_018AAA:
	JSR.w CODE_018AB6
	JSR.w CODE_018B15
CODE_018AB0:
	INC.w $0CF9
	LDX.b $12
CODE_018AB5:
	RTS

;---------------------------------------------------------------------------

CODE_018AB6:
	LDA.w #FXDATA_548000+$60E1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.b #(FXDATA_548000+$60E1)>>16
	LDA.w #$0060
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $1062
	BRA.b CODE_018AF5

CODE_018AC9:
	LDA.w #FXDATA_548000+$6081
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.b #(FXDATA_548000+$6081)>>16
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $1064
	BRA.b CODE_018AF5

DATA_018AD9:
	dw FXDATA_548000+$60C1,FXDATA_548000+$40C1,FXDATA_548000+$4081,FXDATA_548000+$40A1

CODE_018AE1:
	LDY.w $1074
	LDA.w DATA_018AD9,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDY.b #(FXDATA_548000+$4081)>>16
	LDA.w #$0040
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $1068
CODE_018AF5:
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	TYA
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $1076
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $1078
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_0884A5>>16
	LDA.w #FXCODE_0884A5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	RTS

;---------------------------------------------------------------------------

CODE_018B15:
	LDA.w #FXDATA_548000+$60A1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$60A1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w $1066
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $1076
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $1078
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDA.w #$0020
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08855F>>16
	LDA.w #FXCODE_08855F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	RTS

;---------------------------------------------------------------------------

DATA_018B46:
	db $FC,$FC,$20,$0D,$00,$0C,$0C,$1E,$0D,$00,$FC,$04,$0C,$0D,$02,$04
	db $FC,$0E,$0D,$02,$FC,$FC,$3A,$0D,$00,$0C,$0C,$1A,$0D,$00,$FC,$04
	db $08,$0D,$02,$04,$FC,$0A,$0D,$02,$F8,$F8,$C0,$0D,$02,$08,$F8,$C2
	db $0D,$02,$F8,$08,$E0,$0D,$02,$08,$08,$E2,$0D,$02

DATA_018B82:
	db $FC,$0C,$35,$0D,$00,$04,$04,$26,$0D,$02,$FC,$FC,$24,$0D,$02,$FC
	db $FC,$24,$0D,$00,$04,$FC,$22,$0D,$02,$FC,$0C,$2C,$0D,$00,$04,$04
	db $20,$0D,$02,$04,$04,$20,$0D,$00,$0C,$0C,$21,$0D,$00,$FC,$04,$28
	db $0D,$02,$04,$FC,$2A,$0D,$02,$04,$FC,$2A,$0D,$00,$FC,$04,$00,$0D
	db $02,$0C,$0C,$12,$0D,$00,$04,$FC,$02,$0D,$02,$04,$FC,$02,$0D,$00
	db $0C,$0C,$16,$0D,$00,$FC,$04,$04,$0D,$02,$04,$FC,$06,$0D,$02,$04
	db $FC,$06,$0D,$00,$F8,$F8,$CC,$0D,$02,$08,$F8,$CE,$0D,$02,$F8,$08
	db $EC,$0D,$02,$08,$08,$EE,$0D,$02

DATA_018BFA:
	db $00,$00,$D5,$0D,$02

DATA_018BFF:
	db $F8,$F8,$C8,$0D,$02,$08,$F8,$CA,$0D,$02,$F8,$08,$E8,$0D,$02,$08
	db $08,$EA,$0D,$02

DATA_018C13:
	db $FC,$0C,$35,$0F,$00,$04,$04,$26,$0F,$02,$FC,$FC,$24,$0F,$02,$FC
	db $FC,$24,$0F,$00,$04,$FC,$22,$0F,$02,$FC,$0C,$2C,$0F,$00,$04,$04
	db $20,$0F,$02,$04,$04,$20,$0F,$00,$0C,$0C,$21,$0F,$00,$FC,$04,$28
	db $0F,$02,$04,$FC,$2A,$0F,$02,$04,$FC,$2A,$0F,$00,$FC,$04,$00,$0F
	db $02,$0C,$0C,$12,$0F,$00,$04,$FC,$02,$0F,$02,$04,$FC,$02,$0F,$00
	db $0C,$0C,$16,$0F,$00,$FC,$04,$04,$0F,$02,$04,$FC,$06,$0F,$02,$04
	db $FC,$06,$0F,$00,$F8,$F8,$CC,$0F,$02,$08,$F8,$CE,$0F,$02,$F8,$08
	db $EC,$0F,$02,$08,$08,$EE,$0F,$02

DATA_018C8B:
	db $FC,$FC,$20,$0F,$00,$0C,$0C,$1E,$0F,$00,$FC,$04,$0C,$0F,$02,$04
	db $FC,$0E,$0F,$02,$FC,$FC,$3A,$0F,$00,$0C,$0C,$1A,$0F,$00,$FC,$04
	db $08,$0F,$02,$04,$FC,$0A,$0F,$02,$F8,$F8,$C0,$0F,$02,$08,$F8,$C2
	db $0F,$02,$F8,$08,$E0,$0F,$02,$08,$08,$E2,$0F,$02

;---------------------------------------------------------------------------

CODE_018CC7:
	REP.b #$10
	LDY.w $7362,x
	LDA.w $6024,y
	AND.w #$FFF0
	ORA.w #$0004
	STA.w $6024,y
CODE_018CD8:
	REP.b #$10
	LDA.w #$0006
	STA.b $00
	LDY.w $7362,x
	LDA.w $1015
	CMP.w #$0002
	BEQ.b CODE_018D03
CODE_018CEA:
	LDA.w $6004,y
	AND.w #$F1FF
	ORA.w #$0200
	STA.w $6004,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $00
	BNE.b CODE_018CEA
	SEP.b #$10
	RTS

CODE_018D03:
	LDA.w $6004,y
	AND.w #$F1FF
	ORA.w #$0C00
	STA.w $6004,y
	TYA
	CLC
	ADC.w #$0008
	TAY
	DEC.b $00
	BNE.b CODE_018D03
	SEP.b #$10
	RTS

;---------------------------------------------------------------------------

CODE_018D1C:
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_018B46>>16
	STA.w $6000
	LDA.w $7402,x
	STA.w $6002
	LDY.b $78,x
	TYA
	STA.w $6004
	LDA.w $7A36,x
	STA.w $6006
	LDA.w $7A38,x
	STA.w $6008
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $600A
	LDA.w $7680,x
	CLC
	ADC.w #$0008
	STA.w $600E
	LDA.w $7682,x
	CLC
	ADC.w #$0008
	STA.w $6010
	LDA.w #DATA_018B46
	STA.w $6012
	LDA.w #DATA_018B82
	STA.w $6014
	LDA.w #DATA_018BFA
	STA.w $6016
	LDA.w #DATA_018BFF
	STA.w $6018
	LDA.w #DATA_018C13
	STA.w $601A
	LDA.w #DATA_018C8B
	STA.w $601C
	LDA.w #DATA_018297
	STA.w $601E
	LDA.w $106A
	STA.w $6026
	LDA.w $106C
	STA.w $6028
	LDA.w $105C
	STA.w $602A
	LDA.w $105E
	STA.w $602C
	LDA.w #DATA_018927
	STA.w $602E
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $6030
	LDA.w $106E
	STA.w $6032
	LDA.w $107A
	STA.w $6046
	LDA.w $1076
	STA.w $6050
	LDA.w $1078
	STA.w $6052
	LDX.b #FXCODE_08A3BA>>16
	LDA.w #FXCODE_08A3BA
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w $6026
	STA.w $106A
	LDA.w $6028
	STA.w $106C
	LDA.w $6034
	STA.w $1064
	LDA.w $6036
	STA.w $1062
	LDA.w $6038
	STA.w $1066
	LDA.w $603A
	STA.w $1068
	LDA.w $603C
	STA.w $1060
	JSR.w CODE_01909B
	LDY.w $1072
	BNE.b CODE_018E25
	LDA.w $7720,x
	STA.b $00
	LDA.w $603E
	SEC
	SBC.w $7682,x
	CLC
	ADC.w #$FFFB
	STA.w $7720,x
	SEC
	SBC.b $00
	STA.b $00
	CLC
	ADC.w #$0004
	CMP.w #$0008
	BCC.b CODE_018E25
	LDA.w $7182,x
	SEC
	SBC.b $00
	STA.w $7182,x
CODE_018E25:
	LDA.w $6022
	STA.b $0A
	LDA.w $6024
	STA.b $0C
	LDA.w $7680,x
	CLC
	ADC.w #$0060
	CMP.w #$01C0
	BCC.b CODE_018E43
	LDA.w #$0160
	STA.w !RAM_YI_Global_Layer3XPosLo
	BRA.b CODE_018E55

CODE_018E43:
	LDA.w #$0020
	SEC
	SBC.b $0A
	STA.w !RAM_YI_Global_Layer3XPosLo
	LDA.w #$001C
	SEC
	SBC.b $0C
	STA.w !RAM_YI_Global_Layer3YPosLo
CODE_018E55:
	LDA.b $0A
	SEC
	SBC.w $7680,x
	STA.w $7B56,x
	LDA.b $0C
	SEC
	SBC.w $7682,x
	STA.w $7B58,x
	LDA.w #$0011
	STA.w $0B83
	LDA.w $106E
	AND.w #$FF00
	BEQ.b CODE_018E78
	STZ.w $106E
CODE_018E78:
	LDY.b $76,x
	CPY.b #$33
	BMI.b CODE_018E8B
	LDA.w $6058
	SEC
	SBC.w $6056
	SEC
	SBC.w $6122
	BRA.b CODE_018EBE

CODE_018E8B:
	LDA.w $605A
	BIT.w #$0001
	BEQ.b CODE_018E94
CODE_018E93:
	RTS

CODE_018E94:
	CMP.w #$0008
	BNE.b CODE_018E9E
	LDA.w $6058
	BPL.b CODE_018EA1
CODE_018E9E:
	JMP.w CODE_018F72

CODE_018EA1:
	SEC
	SBC.w $6056
	SEC
	SBC.w $6122
	CMP.w #$FFF4
	BCC.b CODE_018E9E
	LDY.w $60AB
	BMI.b CODE_018E93
	LDY.w $7402,x
	CPY.b #$28
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	BPL.b +
	CPY.b #$21
	BPL.b CODE_018EBE
+:
	JMP.w CODE_018F38
CODE_018EBE:
else
	BPL.b CODE_018F38
	CPY.b #$21
	BMI.b CODE_018F38
CODE_018EBE:
endif
	CLC
	ADC.w #$0003
	CLC
	ADC.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	STZ.w $60C0
	INC.w $61B4
	LDY.b $76,x
	CPY.b #$29
	BEQ.b CODE_018EE0
	CPY.b #$2A
	BEQ.b CODE_018EE0
	CPY.b #$33
	BMI.b CODE_018EE7
CODE_018EE0:
	LDA.w #$0029
	STA.w $60BE
	RTS

CODE_018EE7:
	LDY.w $60D4
	BEQ.b CODE_018F37
	LDY.w $107E
	CPY.w $107C
	BNE.b CODE_018F37
	LDA.w #$0060
	STA.w $7AF6,x
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	STZ.w $60A8
	STZ.w $60B4
endif
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w #$0029
	INC.w $107C
	INC.w $107C
	LDY.w $107C
	CPY.b #$06
	BNE.b CODE_018F1A
	JSL.l CODE_02A982
	INC.w $0B7B
	LDA.w #$0033
CODE_018F1A:
	STA.b $76,x
	LDA.w #$0001
	STA.w $7A36,x
	LDY.b #$24
	STY.b $78,x
	LDY.b #$0F
	STY.w $105E
	LDA.w #$0030
	STA.b $18,x
	LDA.w #!Define_YI_SoundID80_BossDefeated
	JSL.l CODE_push_sound_queue
CODE_018F37:
	RTS

CODE_018F38:
	LDA.w #!Define_YI_SoundID1C_StompEnemy
	JSL.l CODE_push_sound_queue
	LDY.b $76,x
	CPY.b #$0A
	BMI.b CODE_018F5B
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	STZ.w $60D4
	RTS

CODE_018F5B:
	JSR.w CODE_018FE3
	LDA.w $7402,x
	AND.w #$0007
	CLC
	ADC.w #$0028
	STA.b $78,x
	LDY.b #$05
	STY.b $76,x
	LDY.b #$18
	BRA.b CODE_018FBD

CODE_018F72:
	CMP.w #$0006
	BNE.b CODE_018F7C
	LDA.w $6058
	BPL.b CODE_018F7F
CODE_018F7C:
	JMP.w CODE_018FD4

CODE_018F7F:
	SEC
	SBC.w $6056
	SEC
	SBC.w $6122
	CMP.w #$FFF4
	BCC.b CODE_018F7C
	LDY.b $76,x
	CPY.b #$0A
	BMI.b CODE_018FA8
	LDA.w #$FB00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	STZ.w $60D4
	RTS

CODE_018FA8:
	LDY.w $60AB
	BMI.b CODE_018F37
	JSR.w CODE_018FE3
	LDA.w #!Define_YI_SoundID39_PiranhaPlantMunch
	JSL.l CODE_push_sound_queue
	LDY.b #$02
	STY.b $76,x
	LDY.b #$17
CODE_018FBD:
	STY.w $105E
	LDA.w #$0001
	STA.w $7A36,x
	INC.w $1070
	LDY.b #$02
	STY.w $1074
	LDA.w #$0040
	STA.b $18,x
	RTS

CODE_018FD4:
	LDY.b $76,x
	CPY.b #$1C
	BMI.b CODE_018FDE
	CPY.b #$27
	BMI.b CODE_018FE2
CODE_018FDE:
	JSL.l CODE_03A858
CODE_018FE2:
	RTS

CODE_018FE3:
	LDA.w #$FB00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	STZ.w $60D4
	LDA.b $10
	AND.w #$003E
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$FD00
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B8595>>16
	LDA.w #FXCODE_0B8595
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDY.w $7400,x
	BEQ.b CODE_01901D
	EOR.w #$FFFF
	INC
CODE_01901D:
	STA.b $00
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.b $04
	LDA.w $7CD6,x
	CLC
	ADC.w $6040
	SEC
	SBC.w #$0008
	STA.b $0A
	LDA.w $7CD8,x
	CLC
	ADC.w $6054
	SEC
	SBC.w #$0004
	STA.b $0C
	LDX.b #FXCODE_0991D5>>16
	LDA.w #FXCODE_0991D5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R6_MultiplierLo
	CPY.b #$06
	BMI.b CODE_019077
CODE_019050:
	STZ.b $02
	JSL.l CODE_0EEBFA
	LDA.b $04
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0028
	STA.w $7002,y
	LDA.w #$0005
	STA.w $7462,y
	LDA.w #$0000
	STA.w $75A2,y
	LDA.w #$0008
	STA.w $7502,y
	STA.w $7500,y
	RTS

CODE_019077:
	LDA.w #$0025
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_019050
	LDA.b $0A
	STA.w $70E2,y
	LDA.b $0C
	STA.w $7182,y
	LDA.b $00
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0040
	STA.w $7542,y
	RTS

CODE_01909B:
	LDA.w $7CD6,x
	PHA
	CLC
	ADC.w $6040
	STA.w $7CD6,x
	LDA.w $7CD8,x
	PHA
	CLC
	ADC.w $6054
	STA.w $7CD8,x
	LDA.w $7BB6,x
	PHA
	LDA.w $7BB8,x
	PHA
	LDA.w #$000C
	STA.w $7BB6,x
	STA.w $7BB8,x
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_0190DA

CODE_0190D1:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0190DA:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_019123
	BEQ.b CODE_019123
	LDA.w $7D38,y
	BEQ.b CODE_0190D1
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.b $00
	LDA.w $7542,y
	STA.b $02
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	LDY.b $76,x
	CPY.b #$0B
	BPL.b CODE_019120
	INC.w $1070
	LDY.b #$06
	STY.w $1074
	LDY.b #$17
	STY.w $105E
	LDA.w #$0020
	STA.b $18,x
	LSR
	STA.w $7A96,x
	LDY.b #$0D
	STY.b $76,x
	LDA.w #!Define_YI_SoundID3F_HitUvula
	JSL.l CODE_push_sound_queue
	BRA.b CODE_019123

CODE_019120:
	JSR.w CODE_01913C
CODE_019123:
	PLA
	STA.w $7BB8,x
	PLA
	STA.w $7BB6,x
	PLA
	STA.w $7CD8,x
	PLA
	STA.w $7CD6,x
CODE_019133:
	RTS

;---------------------------------------------------------------------------

DATA_019134:
	db $1D,$1F

DATA_019136:
	db $08,$0A

DATA_019138:
	dw $0200,$FE00

CODE_01913C:
	LDA.b $02
	BNE.b CODE_019133
	LDA.w $7400,x
	DEC
	EOR.b $00
	BPL.b CODE_019133
	LDY.b $76,x
	CPY.b #$0F
	BMI.b CODE_019156
	CPY.b #$1C
	BMI.b CODE_0191BA
	CPY.b #$1F
	BPL.b CODE_0191BA
CODE_019156:
	INC.w $1070
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $7A38,x
	STZ.w $7A36,x
	INC.w $107A
	LDY.w $107A
	CPY.b #$03
	BMI.b CODE_01919D
	LDY.w $7400,x
	LDA.w DATA_019138,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.w $106E
	INC.w $1072
	LDA.w #$0012
	STA.w $7720,x
	LDY.b #$21
	STY.b $78,x
	LDY.b #$0C
	STY.w $105E
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.b $18,x
	LDY.b #$1F
	STY.b $76,x
	RTS

CODE_01919D:
	SEP.b #$20
	LDA.w DATA_019134-$01,y
	STA.b $78,x
	LDA.w DATA_019136-$01,y
	STA.w $105E
	REP.b #$20
	LDA.w #$0020
	STA.b $18,x
	LDY.b #$04
	STY.w $1074
	LDY.b #$1C
	STY.b $76,x
CODE_0191BA:
	RTS

;---------------------------------------------------------------------------

CODE_0191BB:
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_0191D3

CODE_0191CA:
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_0191D3:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_0191BA
	BEQ.b CODE_0191BA
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_0191CA
	LDA.w $7D38,y
	BEQ.b CODE_0191CA
	LDA.w $7542,y
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.b $02
	TYX
	PHY
	JSL.l CODE_kill_sprite_by_hit_checked
	PLY
	LDA.b $00
	BNE.b CODE_0191CA
	LDA.w $7400,x
	DEC
	EOR.b $02
	BPL.b CODE_0191CA
	LDA.w $7CD8,y
	SEC
	SBC.w $7CD8,x
	BPL.b CODE_0191CA
	LDA.w #!Define_YI_SoundID3F_HitUvula
	JSL.l CODE_push_sound_queue
	LDY.w $107A
	CPY.b #$02
	BMI.b CODE_0191CA
	LDY.b $76,x
	CPY.b #$1C
	BMI.b CODE_0191CA
	CPY.b #$1F
	BPL.b CODE_0191CA
	JMP.w CODE_019156

;---------------------------------------------------------------------------

CODE_01922A:
	LDA.w $7A36,x
	CLC
	ADC.b $18,x
	CMP.w #$0100
	BMI.b CODE_019249
	SEP.b #$20
	LDA.b $78,x
	STA.w $7402,x
	REP.b #$20
	LDA.w $105E
	STA.w $105C
	LDA.w #$0000
	STA.b $18,x
CODE_019249:
	STA.w $7A36,x
CODE_01924C:
	RTS

;---------------------------------------------------------------------------

CODE_01924D:
	LDA.w $7AF6,x
	BEQ.b CODE_01924C
	DEC
	BEQ.b CODE_019291
	AND.w #$0004
	BNE.b CODE_019291
	LDX.b #$14
CODE_01925C:
	LDA.l DATA_5FA570,x
	STA.l $702D6E,x
	STA.l YI_Global_PaletteMirror[$01].LowByte,x
	STA.l $702F2E,x
	STA.l YI_Global_PaletteMirror[$E1].LowByte,x
	STA.l $702F4E,x
	STA.l YI_Global_PaletteMirror[$F1].LowByte,x
	DEX
	DEX
	BPL.b CODE_01925C
	LDX.b #$06
CODE_01927E:
	LDA.l DATA_5FA586,x
	STA.l $702D84,x
	STA.l YI_Global_PaletteMirror[$0C].LowByte,x
	DEX
	DEX
	BPL.b CODE_01927E
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

CODE_019291:
	LDX.b #$1C
CODE_019293:
	LDA.l DATA_5FDA80,x
	STA.l $702D6E,x
	STA.l YI_Global_PaletteMirror[$01].LowByte,x
	LDA.l DATA_5FDAA0,x
	STA.l $702F2E,x
	STA.l YI_Global_PaletteMirror[$E1].LowByte,x
	LDA.l DATA_5FDAC0,x
	STA.l $702F4E,x
	STA.l YI_Global_PaletteMirror[$F1].LowByte,x
	DEX
	DEX
	BPL.b CODE_019293
	LDA.l DATA_5FDA9E
	STA.l $702F2C
	STA.l YI_Global_PaletteMirror[$E0].LowByte
	LDA.l DATA_5FDABE
	STA.l $702F4C
	STA.l YI_Global_PaletteMirror[$F0].LowByte
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

DATA_0192D6:
	dw $FF20,$00E0

CODE_0192DA:
	LDA.w $70E2,x
	SEC
	SBC.w $1082
	CLC
	ADC.w #$00E0
	CMP.w #$01C0
	BCC.b CODE_019311
	STA.b $00
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0192F5
	LDA.w $7400,x
	DEC
CODE_0192F5:
	EOR.b $00
	BMI.b CODE_019311
	LDY.b #$00
	LDA.b $00
	BMI.b CODE_019301
	INY
	INY
CODE_019301:
	LDA.w $1082
	CLC
	ADC.w DATA_0192D6,y
	STA.w $70E2,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
CODE_019311:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $00: CODE_hookbill_start_crawl. Pre-walk; sets $7A98 timer, waits for
; player to step in close (X-pos compare against Layer1XPos + $00A0),
; then transitions to state $08 (head_back) and starts the crawl cycle.
; INPUTS:   X = slot; $7A98,x = countdown; $10 = frame; $70E2,x = X-pos
; OUTPUTS:  $76,x = $08 on transition; $18,x = $0020; $7A98,x = $40
; CALLERS:  DATA_hookbill_state_ptr[0]
;-------------------------------------------------------------------------
CODE_019312:
CODE_hookbill_start_crawl:
	TYX
	LDY.b #$01
	STY.b $76,x
	LDA.w #$0040
	STA.w $7A98,x
	LDA.b $10
	AND.w #$0001
	BEQ.b CODE_019366
	LDA.w $70E2,x
	SEC
	SBC.w $1082
	CLC
	ADC.w #$00A0
	CMP.w #$0140
	BCC.b CODE_01933E
	STA.b $00
	LDA.w $7400,x
	DEC
	EOR.b $00
	BPL.b CODE_019366
CODE_01933E:
	LDA.b $78,x
	AND.w #$0007
	CLC
	ADC.w #$0028
	STA.b $78,x
	LDY.b #$18
	STY.w $105E
	LDA.w #$0001
	STA.w $7A36,x
	INC.w $1070
	LDA.w #$0020
	STA.b $18,x
	LDA.w #$0040
	STA.w $7A96,x
	LDY.b #$08
	STY.b $76,x
CODE_019366:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $02: CODE_hookbill_crawl_forward. The main "walking" state.
; Per frame: zeros animation accumulators, clamps Y vel, when both
; $7A96 and $7A36 expire and $7A98 is 0 -> back to state $00.
; If $7A98 nonzero, advances anim frame (INC $78,x), every $0008 frames
; plays "thunder-lakitu-attacking-6" sound (== Hookbill footstep).
; Then JSR CODE_hookbill_check_wall_turn for wall-collision check -> may write $76,x.
; INPUTS:   X = slot; $7A96,x, $7A36,x, $7A98,x timers
; OUTPUTS:  Anim frame on $78,x; possibly $76,x = new state on collision
; CALLERS:  DATA_hookbill_state_ptr[1]
;-------------------------------------------------------------------------
CODE_019367:
CODE_hookbill_crawl_forward:
	TYX
	STZ.w $105C
	STZ.w $105E
	STZ.w $1070
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $7A38,x
	LDA.w $7A96,x
	BNE.b CODE_0193B6
	LDA.w #$0020
	STA.b $18,x
	LDA.w $7A36,x
	BNE.b CODE_0193B6
	LDA.w $7A98,x
	BNE.b CODE_019391
	STZ.b $76,x
	RTS

CODE_019391:
	SEP.b #$20
	LDA.b $78,x
	INC
	AND.b #$07
	STA.b $78,x
	REP.b #$20
	LDA.w $7402,x
	AND.w #$0003
	BNE.b CODE_0193B6
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #!Define_YI_SoundID56_ThunderLakituAttacking6
	JSL.l CODE_push_sound_queue
	INC.w $7A36,x
	STZ.b $18,x
CODE_0193B6:
	JSR.w CODE_hookbill_check_wall_turn
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_hookbill_check_wall_turn: wall-collision sub. Reads $77C2,x (collision flags low),
; compares against $7400,x (current facing); if equal, return (no wall).
; Otherwise marks $1070 / $106E for turn, sets $78,x = $18 (turn anim
; frame), $105E = $03 (turn motion), $18,x = $10, and either:
;   - $76,x = $16 (turn) if currently $01 (just-walking)
;   - $76,x = $18 (jump-fall) otherwise, plus EXRAM YSpeed = $FC00
; INPUTS:   $77C2,x, $7400,x
; OUTPUTS:  $76,x possibly written
; MODIFIES: A, X (intact), Y
; CALLERS:  CODE_hookbill_crawl_forward, CODE_hookbill_walk_forward
;-------------------------------------------------------------------------
CODE_0193BA:
CODE_hookbill_check_wall_turn:
	LDA.w $77C2,x
	AND.w #$00FF
	CMP.w $7400,x
	BEQ.b CODE_0193FF
	INC.w $1070
	INC.w $106E
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $7A38,x
	STZ.w $7A36,x
	LDY.b #$18
	STY.b $78,x
	LDY.b #$03
	STY.w $105E
	LDA.w #$0010
	STA.b $18,x
	LDY.b $76,x
	CPY.b #$01
	BNE.b CODE_0193F0
	LDY.b #$16
	STY.b $76,x
	RTS

CODE_0193F0:
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $78,x
	INC.w $105E
	LDY.b #$18
	STY.b $76,x
CODE_0193FF:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $04: CODE_hookbill_head_spit_egg. When $7A36 timer expires, sets
; $18,x = $40 (squat anim length), $7A96 = $30 (cooldown), INC $76,x.
; CALLERS:  DATA_hookbill_state_ptr[2]
;-------------------------------------------------------------------------
CODE_019400:
CODE_hookbill_head_spit_egg:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019416
	STZ.w $105E
	LDA.w #$0040
	STA.b $18,x
	LDA.w #$0030
	STA.w $7A96,x
	INC.b $76,x
CODE_019416:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $06: CODE_hookbill_head_nudge_up. After spit, briefly nudges head up.
; When $7A96 expires, sets $18,x = $80, INC $76,x.
; CALLERS:  DATA_hookbill_state_ptr[3]
;-------------------------------------------------------------------------
CODE_019417:
CODE_hookbill_head_nudge_up:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_019427
	STZ.w $1074
	LDA.w #$0080
	STA.b $18,x
	INC.b $76,x
CODE_019427:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $08 (also re-used by $0E): CODE_hookbill_head_back. Returns head to
; rest. When $7A36 expires, sets $7A98 = $40, $76,x = $01 (state $02
; crawl_forward).
; CALLERS:  DATA_hookbill_state_ptr[4], DATA_hookbill_state_ptr[7]
;-------------------------------------------------------------------------
CODE_019428:
CODE_hookbill_head_back:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019438
	LDA.w #$0040
	STA.w $7A98,x
	LDY.b #$01
	STY.b $76,x
CODE_019438:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $0A: CODE_hookbill_shell_spit_egg. Mirror of head_spit but uses the
; shell. Sets $78,x = $7402 - $28 (shell anim base), $18,x = $40,
; $7A96 = $30, INC $76,x.
; CALLERS:  DATA_hookbill_state_ptr[5]
;-------------------------------------------------------------------------
CODE_019439:
CODE_hookbill_shell_spit_egg:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019458
	LDA.w $7402,x
	SEC
	SBC.w #$0028
	STA.b $78,x
	STZ.w $105E
	LDA.w #$0040
	STA.b $18,x
	LDA.w #$0030
	STA.w $7A96,x
	INC.b $76,x
CODE_019458:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $0C: CODE_hookbill_shell_nudge_up. Shell side of head_nudge_up.
; CALLERS:  DATA_hookbill_state_ptr[6]
;-------------------------------------------------------------------------
CODE_019459:
CODE_hookbill_shell_nudge_up:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_019469
	STZ.w $1074
	LDA.w #$0080
	STA.b $18,x
	INC.b $76,x
CODE_019469:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $10 (also $14): CODE_hookbill_stand_up. Wait for $7A36 timer, INC $76.
; CALLERS:  DATA_hookbill_state_ptr[8], DATA_hookbill_state_ptr[10]
;-------------------------------------------------------------------------
CODE_01946A:
CODE_hookbill_stand_up:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019472
	INC.b $76,x
CODE_019472:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $12: CODE_hookbill_stare_forward. After stand_up, holds the "looking
; at player" anim until $7A96 expires; configures animation frame range
; ($78,x = $7402 base + (-$29 & $07) | $08), $105E = $01.
; CALLERS:  DATA_hookbill_state_ptr[9]
;-------------------------------------------------------------------------
CODE_019473:
CODE_hookbill_stare_forward:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_019493
	INC.b $76,x
CODE_01947B:
	LDA.b $78,x
	SEC
	SBC.w #$0029
	AND.w #$0007
	ORA.w #$0008
	STA.b $78,x
	LDY.b #$01
	STY.w $105E
	LDA.w #$0008
	STA.b $18,x
CODE_019493:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $16: CODE_hookbill_walk_forward. Faster "ready to attack" walk.
; Per frame: sets $105C/$105E = 1 (walk anim speed),
; clears $7A38 (Y vel hi accumulator). When $7A98 zero and $7A36 zero,
; if collision check $77C2 matches $7400 and Y-pos OK, transition to
; state $1A (egg_hit_while_running == prepare for combat). Else advance
; anim and play footstep sound. Then JSR CODE_hookbill_check_wall_turn (wall-turn check).
; CALLERS:  DATA_hookbill_state_ptr[11]
;-------------------------------------------------------------------------
CODE_019494:
CODE_hookbill_walk_forward:
	TYX
	LDA.w #$0001
	STA.w $105C
	STA.w $105E
	STZ.w $106E
	LDA.w $7974
	AND.w #$0001
	BNE.b CODE_0194AC
	STZ.w $1070
CODE_0194AC:
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $7A38,x
	LDA.w $7A96,x
	BEQ.b CODE_0194BD
	JMP.w CODE_019525

CODE_0194BD:
	LDA.w #$0020
	STA.b $18,x
	LDA.w $7A36,x
	BNE.b CODE_019525
	LDA.w $7A98,x
	BNE.b CODE_0194FE
	LDY.w $77C2,x
	TYA
	CMP.w $7400,x
	BNE.b CODE_0194FE
	LDA.w $7C16,x
	CLC
	ADC.w #$0070
	CMP.w #$00E0
	BCS.b CODE_0194FE
	SEP.b #$20
	LDA.b $78,x
	INC
	AND.b #$07
	ORA.b #$10
	STA.b $78,x
	REP.b #$20
	LDY.b #$02
	STY.w $105E
	STY.w $1074
	LDA.w #$0020
	STA.b $18,x
	INC.b $76,x
	RTS

CODE_0194FE:
	SEP.b #$20
	LDA.b $78,x
	INC
	AND.b #$07
	ORA.b #$08
	STA.b $78,x
	REP.b #$20
	LDA.w $7402,x
	AND.w #$0003
	BNE.b CODE_019525
	LDA.w #$0008
	STA.w $7A96,x
	LDA.w #!Define_YI_SoundID56_ThunderLakituAttacking6
	JSL.l CODE_push_sound_queue
	INC.w $7A36,x
	STZ.b $18,x
CODE_019525:
	JSR.w CODE_hookbill_check_wall_turn
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $18: CODE_hookbill_hunch_forward. After collision-jump; when $7A36
; expires, sets $7A96 = $40, $7A98 = $C0, $76,x = $0E (head_back).
; CALLERS:  DATA_hookbill_state_ptr[12]
;-------------------------------------------------------------------------
CODE_019529:
CODE_hookbill_hunch_forward:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_01953F
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$00C0
	STA.w $7A98,x
	LDY.b #$0E
	STY.b $76,x
CODE_01953F:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $1A: CODE_hookbill_egg_hit_while_running. When $7A96 expires, sets
; $1070 += 1, $1074 = 0, $76,x = $0A (shell_spit), then JMP to
; CODE_01947B (sets up stare anim).
; CALLERS:  DATA_hookbill_state_ptr[13]
;-------------------------------------------------------------------------
CODE_019540:
CODE_hookbill_egg_hit_while_running:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_01953F
	INC.w $1070
	STZ.w $1074
	LDY.b #$0A
	STY.b $76,x
	JMP.w CODE_01947B

;---------------------------------------------------------------------------

DATA_019553:
	dw $0500,$0060

DATA_019557:
	dw $FD80,$0280,$FF40,$00C0,$FF00,$0100

;-------------------------------------------------------------------------
; State $1C: CODE_hookbill_run_forward. Charge-attack run. Sets X-vel from
; DATA_019557 table (6 entries pick speed by current state), runs
; SuperFX FXCODE_0B86B6 twice to compute lookahead distance and
; predict player-X collision. If predicted to land on player, sets
; $7AF6,x = $20 (i-frames), state -> $0D (dive prep). If predicted to
; clear player, transitions to state $1E (CODE_hookbill_dive) via
; JMP CODE_019669 + INC $76.
; CALLERS:  DATA_hookbill_state_ptr[14]
;-------------------------------------------------------------------------
CODE_019563:
CODE_hookbill_run_forward:
	TYX
	LDA.w #$0002
	STA.w $105C
	STA.w $105E
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.b $18,x
	LDA.w $7A36,x
	BNE.b CODE_01953F
	SEP.b #$20
	LDA.b $78,x
	INC
	AND.b #$07
	ORA.b #$10
	STA.b $78,x
	REP.b #$20
	LDA.w $7402,x
	AND.w #$0003
	BNE.b CODE_019599
	LDA.w #!Define_YI_SoundID56_ThunderLakituAttacking6
	JSL.l CODE_push_sound_queue
CODE_019599:
	LDY.b #$08
	LDA.w $7400,x
	BEQ.b CODE_0195AD
	INY
	INY
	SEC
	SBC.w #$0020
	CMP.w $7E1A
	BPL.b CODE_0195D6
	BRA.b CODE_0195BB

CODE_0195AD:
	LDY.b #$08
	LDA.w $70E2,x
	SEC
	SBC.w #$0070
	CMP.w $7E18
	BMI.b CODE_0195D6
CODE_0195BB:
	LDA.w $7A96,x
	BNE.b CODE_0195E8
	LDY.w $77C2,x
	TYA
	CMP.w $7400,x
	BEQ.b CODE_0195D9
	LDA.w $7A98,x
	BNE.b CODE_0195E8
	LDA.w $7400,x
	CLC
	ADC.w #$0004
	TAY
CODE_0195D6:
	JMP.w CODE_019669

CODE_0195D9:
	LDA.w $7C16,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	CLC
	ADC.w #$0050
	CMP.w #$00A0
	BCC.b CODE_0195E9
CODE_0195E8:
	RTS

CODE_0195E9:
	CLC
	ADC.w #$FFD0
	CMP.w #$0040
	BCC.b CODE_0195E8
	LDA.w $60A8
	BMI.b CODE_0195FB
	EOR.w #$FFFF
	INC
CODE_0195FB:
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b #$00
	LDA.w $60A8
	EOR.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	BMI.b CODE_01960A
	INY
	INY
CODE_01960A:
	LDA.w DATA_019553,y
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w #$0100
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_019646
	LDA.w $7400,x
	CLC
	ADC.w #$0004
	TAY
	BRA.b CODE_019669

CODE_019646:
	LDY.b #$00
	CLC
	ADC.w #$0400
	CMP.w #$0800
	BCC.b CODE_019657
	BMI.b CODE_019669
	INY
	INY
	BRA.b CODE_019669

CODE_019657:
	CLC
	ADC.w #$FCC0
	CMP.w #$0180
	BCS.b CODE_01966F
	LDY.b #$04
	CMP.w #$00C0
	BMI.b CODE_019669
	INY
	INY
CODE_019669:
	LDA.w DATA_019557,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_01966F:
	INC.w $1070
	INC.w $106E
	INC.w $1072
	LDA.w #$000A
	STA.w $7720,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $7A38,x
	LDY.b #$1A
	STY.b $78,x
	LDA.w #$FB00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0280
	STA.w $75E2,x
	LDA.w #$0028
	STA.w $7542,x
	LDY.b #$05
	STY.w $105E
	LDA.w #$0010
	STA.b $18,x
	INC.b $76,x
	RTS

;---------------------------------------------------------------------------

DATA_0196AA:
	dw $FF00,$0100

;-------------------------------------------------------------------------
; State $1E: CODE_hookbill_dive. After charge, dives. When $7A36 expires and
; $7860,x & 1 (grounded), reads X-vel from DATA_0196AA[$7400], sets
; gravity $75E2 = $0400, drag $7542 = $0040, $78,x = $1B (dive anim),
; $18,x = $20 (dive timer), $61C6 = $20 (small screen-shake), plays
; sound $47 (explosion), INC $76,x.
; CALLERS:  DATA_hookbill_state_ptr[15]
;-------------------------------------------------------------------------
CODE_0196AE:
CODE_hookbill_dive:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_0196EB
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_0196EB
	LDY.w $7400,x
	LDA.w DATA_0196AA,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0400
	STA.w $75E2,x
	LDA.w #$0040
	STA.w $7542,x
	LDY.b #$1B
	STY.b $78,x
	LDY.b #$06
	STY.w $105E
	LDA.w #$0020
	STA.b $18,x
	STA.w $61C6
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	INC.b $76,x
CODE_0196EB:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $20: CODE_hookbill_dive_land. Brief landing pause. Sets $78,x = $1A,
; $18,x = $10, EXRAM YSpeed = $FE00 (slight bounce up), INC $76.
; CALLERS:  DATA_hookbill_state_ptr[16]
;-------------------------------------------------------------------------
CODE_0196EC:
CODE_hookbill_dive_land:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019708
	LDY.b #$1A
	STY.b $78,x
	LDY.b #$05
	STY.w $105E
	LDA.w #$0010
	STA.b $18,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_019708:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $22: CODE_hookbill_dive_land_2. After second ground touch ($7860&1),
; sets $1074 = $06, $7540 = $0008 (X-drag), $78 = $1C, $105E = $07,
; $18 = $20, $61C6 = $20 (shake again), sound $47, INC $76.
; CALLERS:  DATA_hookbill_state_ptr[17]
;-------------------------------------------------------------------------
CODE_019709:
CODE_hookbill_dive_land_2:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_01973C
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_01973C
	LDY.b #$06
	STY.w $1074
	LDA.w #$0008
	STA.w $7540,x
	LDY.b #$1C
	STY.b $78,x
	LDY.b #$07
	STY.w $105E
	LDA.w #$0020
	STA.b $18,x
	STA.w $61C6
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	INC.b $76,x
CODE_01973C:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $24: CODE_hookbill_dive_land_3. Decay X-vel by $0008 each frame; when
; vel < $10, freezes drag/vel and on next frame ($7A36 expired),
; sets $78 = $1A, $18 = $08, INC $76.
; CALLERS:  DATA_hookbill_state_ptr[18]
;-------------------------------------------------------------------------
CODE_01973D:
CODE_hookbill_dive_land_3:
	TYX
	LDY.b #$02
	STY.b $00
	LDA.w $7A36,x
	BNE.b CODE_019749
	DEC.b $00
CODE_019749:
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CLC
	ADC.w #$0008
	CMP.w #$0010
	BCS.b CODE_01975D
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	DEC.b $00
CODE_01975D:
	LDY.b $00
	BNE.b CODE_019771
	LDY.b #$1A
	STY.b $78,x
	LDY.b #$05
	STY.w $105E
	LDA.w #$0008
	STA.b $18,x
	INC.b $76,x
CODE_019771:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $26: CODE_hookbill_dive_land_4. Loads $16,x = $08 (8 blinks),
; INC $76,x. Single-frame state.
; CALLERS:  DATA_hookbill_state_ptr[19]
;-------------------------------------------------------------------------
CODE_019772:
CODE_hookbill_dive_land_4:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_01977F
	LDA.w #$0008
	STA.b $16,x
	INC.b $76,x
CODE_01977F:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $28: CODE_hookbill_dive_blink. Each tick decrements $16,x; while >=0,
; toggles palette ($1074 ^= $06) and resets $7A96 = $08. When $16,x
; goes -1, exits to state $2A: sets $78,x = $03, $18,x = $10,
; $106E |= $FF00 (palette-row override), $1072/$1074 = 0, INC $76.
; CALLERS:  DATA_hookbill_state_ptr[20]
;-------------------------------------------------------------------------
CODE_019780:
CODE_hookbill_dive_blink:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_0197B7
	DEC.b $16,x
	BPL.b CODE_0197A8
	LDY.b #$03
	STY.b $78,x
	STZ.w $105E
	LDA.w #$0010
	STA.b $18,x
	LDA.w $106E
	ORA.w #$FF00
	STA.w $106E
	STZ.w $1072
	STZ.w $1074
	INC.b $76,x
	RTS

CODE_0197A8:
	LDA.w $1074
	EOR.w #$0006
	STA.w $1074
	LDA.w #$0008
	STA.w $7A96,x
CODE_0197B7:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $2A: CODE_hookbill_dive_get_up. When $7A36 expires, sets $7A98 = $40,
; $76,x = $01 (state $02 crawl_forward -- back into the walk cycle).
; CALLERS:  DATA_hookbill_state_ptr[21]
;-------------------------------------------------------------------------
CODE_0197B8:
CODE_hookbill_dive_get_up:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_0197C8
	LDA.w #$0040
	STA.w $7A98,x
	LDY.b #$01
	STY.b $76,x
CODE_0197C8:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $2C: CODE_hookbill_turnaround_retract. When $7A36 expires, flips
; facing ($7400,x ^= $0002), sets EXRAM YSpeed = $FC00 (small jump),
; $16,x = $FC00 (used as state-flag), INC $76.
; CALLERS:  DATA_hookbill_state_ptr[22]
;-------------------------------------------------------------------------
CODE_0197C9:
CODE_hookbill_turnaround_retract:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_0197E2
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w #$FC00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.b $16,x
	INC.b $76,x
CODE_0197E2:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $2E: CODE_hookbill_turnaround_jump. Checks $7223,x (sprite-on-ground
; flag) -- if grounded, sets $78,x = $02, $18 = $10, RTS. Otherwise,
; when $7A36 = 0 and $7860&1 (re-landing), sets $106E |= $FF00,
; $7A98 = $40, $76 = $01 (back to crawl).
; CALLERS:  DATA_hookbill_state_ptr[23]
;-------------------------------------------------------------------------
CODE_0197E3:
CODE_hookbill_turnaround_jump:
	TYX
	LDY.w $7223,x
	BMI.b CODE_01981C
	LDA.b $16,x
	BEQ.b CODE_0197FC
	STZ.b $16,x
	LDY.b #$02
	STY.b $78,x
	STZ.w $105E
	LDA.w #$0010
	STA.b $18,x
	RTS

CODE_0197FC:
	LDA.w $7A36,x
	BNE.b CODE_01981C
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_01981C
	LDA.w $106E
	ORA.w #$FF00
	STA.w $106E
	LDA.w #$0040
	STA.w $7A98,x
	LDY.b #$01
	STY.b $76,x
CODE_01981C:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $30: CODE_hookbill_turnaround_stand_retract. When grounded,
; zeros EXRAM YSpeed and $7542 drag, DEC $78,x (frame back), $105E = $03,
; $18,x = $20, INC $76.
; CALLERS:  DATA_hookbill_state_ptr[24]
;-------------------------------------------------------------------------
CODE_01981D:
CODE_hookbill_turnaround_stand_retract:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_01983C
	LDY.w $7223,x
	BMI.b CODE_01983C
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	DEC.b $78,x
	LDY.b #$03
	STY.w $105E
	LDA.w #$0020
	STA.b $18,x
	INC.b $76,x
CODE_01983C:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $32 (also $34): CODE_hookbill_turnaround_stand_rotate. Two-phase:
;   - First time ($76 = $32): $78 = $0A, $7542 = $0040, $18 = $10,
;     $105E = $0001, INC $76.
;   - Second time ($76 = $34, == $19/2): INC $78, flip facing, $18 = $20,
;     $105E = $0004, INC $76.
; CALLERS:  DATA_hookbill_state_ptr[25], DATA_hookbill_state_ptr[26]
;-------------------------------------------------------------------------
CODE_01983D:
CODE_hookbill_turnaround_stand_rotate:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019875
	LDY.b $76,x
	CPY.b #$19
	BEQ.b CODE_01985D
	LDY.b #$0A
	STY.b $78,x
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0010
	STA.b $18,x
	LDA.w #$0001
	BRA.b CODE_019870

CODE_01985D:
	INC.b $78,x
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
	LDA.w #$0020
	STA.b $18,x
	LDA.w #$0004
CODE_019870:
	STA.w $105E
	INC.b $76,x
CODE_019875:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $36: CODE_hookbill_turnaround_fall. Fall after stand_rotate. When
; $7860&1 (land), $106E |= $FF00, $7A98 = $40, $76 = $09 (state $12).
; CALLERS:  DATA_hookbill_state_ptr[27]
;-------------------------------------------------------------------------
CODE_019876:
CODE_hookbill_turnaround_fall:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019897
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_019897
	LDA.w $106E
	ORA.w #$FF00
	STA.w $106E
	LDA.w #$0040
	STA.w $7A98,x
	LDY.b #$09
	STY.b $76,x
CODE_019897:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $38: CODE_hookbill_egg_hit_init. First reaction to an egg-hit.
; Sets $16,x = $14 (cry duration), INC $76. CALLERS: DATA_hookbill_state_ptr[28]
;-------------------------------------------------------------------------
CODE_019898:
CODE_hookbill_egg_hit_init:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_0198A5
	LDA.w #$0014
	STA.b $16,x
	INC.b $76,x
CODE_0198A5:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $3A: CODE_hookbill_egg_hit_cry. Animates "crying" by toggling $78,x
; +/-1 each $16 frame. When $16,x exhausted, $1074 = $06, $78 = $0A,
; $105E = $01, $18 = $10, INC $76. CALLERS: DATA_hookbill_state_ptr[29]
;-------------------------------------------------------------------------
CODE_0198A6:
CODE_hookbill_egg_hit_cry:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_0198E7
	DEC.b $16,x
	BPL.b CODE_0198C7
	LDY.b #$06
	STY.w $1074
	LDY.b #$0A
	STY.b $78,x
	LDA.w #$0001
	STA.w $105E
	LDA.w #$0010
	STA.b $18,x
	INC.b $76,x
	RTS

CODE_0198C7:
	LDA.b $16,x
	AND.w #$0001
	ASL
	DEC
	STA.b $00
	CLC
	ADC.w $105E
	STA.w $105E
	SEP.b #$20
	LDA.b $78,x
	CLC
	ADC.b $00
	STA.b $78,x
	REP.b #$20
	LDA.w #$0020
	STA.b $18,x
CODE_0198E7:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $3C: CODE_hookbill_egg_hit_not_egged_again. Return to walk after a
; minor hit. $1074 = 0, $107A = 0, $7A98 = $40, $76 = $09 ($12 stand_up).
; CALLERS: DATA_hookbill_state_ptr[30]
;-------------------------------------------------------------------------
CODE_0198E8:
CODE_hookbill_egg_hit_not_egged_again:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_0198FE
	STZ.w $1074
	STZ.w $107A
	LDA.w #$0040
	STA.w $7A98,x
	LDY.b #$09
	STY.b $76,x
CODE_0198FE:
	RTS

;---------------------------------------------------------------------------

DATA_0198FF:
	dw $0100,$FF00

;-------------------------------------------------------------------------
; State $3E: CODE_hookbill_egg_hit_final_init. Reached when 3rd egg-hit
; lands. Sets X-vel from DATA_0198FF[$7400] (push back $0100/$FF00),
; INC $78,x, INC $105E, $18 = $20, $61C6 = $20 (shake), sound $47,
; INC $76. CALLERS: DATA_hookbill_state_ptr[31]
;-------------------------------------------------------------------------
CODE_019903:
CODE_hookbill_egg_hit_final_init:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019930
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_019930
	LDY.w $7400,x
	LDA.w DATA_0198FF,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.b $78,x
	INC.w $105E
	LDA.w #$0020
	STA.b $18,x
	STA.w $61C6
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	INC.b $76,x
CODE_019930:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $40: CODE_hookbill_egg_hit_final_hop. INC $78, INC $105E, $18 = $10,
; EXRAM YSpeed = $FE00 (small hop), INC $76.
; CALLERS: DATA_hookbill_state_ptr[32]
;-------------------------------------------------------------------------
CODE_019931:
CODE_hookbill_egg_hit_final_hop:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019949
	INC.b $78,x
	INC.w $105E
	LDA.w #$0010
	STA.b $18,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	INC.b $76,x
CODE_019949:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $42: CODE_hookbill_egg_hit_final_fall. Wait for ground hit and X-vel
; decay to 0; on land plays sound $47 once; on full stop, DEC $78,
; DEC $105E, $18 = $08, $61C6 = $20, INC $76.
; CALLERS: DATA_hookbill_state_ptr[33]
;-------------------------------------------------------------------------
CODE_01994A:
CODE_hookbill_egg_hit_final_fall:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_019990
	LDY.b #$06
	CPY.w $1074
	BEQ.b CODE_019964
	STY.w $1074
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
CODE_019964:
	LDA.w #$0008
	STA.w $7540,x
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$0010
	BCS.b CODE_019990
	STZ.w $7540,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A36,x
	BNE.b CODE_019990
	DEC.b $78,x
	DEC.w $105E
	LDA.w #$0008
	STA.b $18,x
	LDA.w #$0020
	STA.w $61C6
	INC.b $76,x
CODE_019990:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $44: CODE_hookbill_egg_hit_final_lean. $16,x = $14 (wobble count),
; $1074 = $04, DEC $78, DEC $105E, $18 = $20, INC $76.
; CALLERS: DATA_hookbill_state_ptr[34]
;-------------------------------------------------------------------------
CODE_019991:
CODE_hookbill_egg_hit_final_lean:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_0199AD
	LDA.w #$0014
	STA.b $16,x
	LDY.b #$04
	STY.w $1074
	DEC.b $78,x
	DEC.w $105E
	LDA.w #$0020
	STA.b $18,x
	INC.b $76,x
CODE_0199AD:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $46: CODE_hookbill_egg_hit_final_wobble. Each tick decrements $16,x
; while toggling $78,x +/-1 and $105E. When $16,x exhausted, $1074 = $02,
; $7A96 = $40, $78 = $18, $105E = $10, INC $76.
; CALLERS: DATA_hookbill_state_ptr[35]
;-------------------------------------------------------------------------
CODE_0199AE:
CODE_hookbill_egg_hit_final_wobble:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_0199EF
	DEC.b $16,x
	BPL.b CODE_0199CF
	LDY.b #$02
	STY.w $1074
	LDA.w #$0040
	STA.w $7A96,x
	LDY.b #$18
	STY.b $78,x
	LDY.b #$10
	STY.w $105E
	INC.b $76,x
	RTS

CODE_0199CF:
	LDA.b $16,x
	AND.w #$0001
	ASL
	DEC
	STA.b $00
	CLC
	ADC.w $105E
	STA.w $105E
	SEP.b #$20
	LDA.b $78,x
	CLC
	ADC.b $00
	STA.b $78,x
	REP.b #$20
	LDA.w #$0020
	STA.b $18,x
CODE_0199EF:
	LDA.w $7A98,x
	BNE.b CODE_0199FA
	LDA.w #$0008
	STA.w $7A98,x
CODE_0199FA:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $48: CODE_hookbill_egg_hit_final_freeze. Wait until $7A96 == 0,
; then $16,x = $0C (hop count), compute $1088 = abs($1060 - $0080)
; (X-distance from screen center), INC $76. CALLERS: DATA_hookbill_state_ptr[36]
;-------------------------------------------------------------------------
CODE_0199FB:
CODE_hookbill_egg_hit_final_freeze:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_019A2C
	LDA.b $16,x
	BEQ.b CODE_019A0D
	STZ.b $16,x
	LDA.w #$0020
	STA.b $18,x
	RTS

CODE_019A0D:
	LDA.w $7A36,x
	BNE.b CODE_019A2C
	LDA.w #$000C
	STA.b $16,x
	LDA.w $1060
	SEC
	SBC.w #$0080
	LDY.w $7400,x
	BNE.b CODE_019A27
	EOR.w #$FFFF
	INC
CODE_019A27:
	STA.w $1088
	INC.b $76,x
CODE_019A2C:
	RTS

;---------------------------------------------------------------------------

DATA_019A2D:
	dw $FE00,$0200

;-------------------------------------------------------------------------
; State $4A: CODE_hookbill_hop_wobble. Each frame toggles $105E by $16&1,
; decrements $16; when $16 done, $7A96 = $08, INC $76. Then runs
; SuperFX FXCODE_08A929 with $1088 (X-distance) and $1060 to update the
; body tilt parameter $1088. CALLERS: DATA_hookbill_state_ptr[37]
;-------------------------------------------------------------------------
CODE_019A31:
CODE_hookbill_hop_wobble:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019A64
	DEC.b $16,x
	BPL.b CODE_019A44
	LDA.w #$0008
	STA.w $7A96,x
	INC.b $76,x
	RTS

CODE_019A44:
	LDA.b $16,x
	AND.w #$0001
	PHP
	ASL
	DEC
	CLC
	ADC.w $105E
	STA.w $105E
	LDA.w #$0030
	STA.b $18,x
	PLP
	BEQ.b CODE_019A64
	LDA.w $7400,x
	EOR.w #$0002
	STA.w $7400,x
CODE_019A64:
	LDA.w $1060
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $1088
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0080
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0048
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08A929>>16
	LDA.w #FXCODE_08A929
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STA.w $1088
CODE_019A91:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $4C: CODE_hookbill_hop_one. After wobble, if $16,x flag set, pulls
; X-vel from DATA_019A2D, sets YSpeed = $FA00, $105E = $03, $18 = $08
; ($16 cleared). If grounded ($7860&1) and not in $75E0 (gravity flag),
; sets gravity $75E2 = $0800, $7542 = $0060, plays sound $47, $16,x = 3
; (count for next hops), $61C8 = $20, $7A96 = $04, INC $76.
; CALLERS: DATA_hookbill_state_ptr[38]
;-------------------------------------------------------------------------
CODE_019A92:
CODE_hookbill_hop_one:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_019A91
	LDY.b $16,x
	BEQ.b CODE_019ABE
	STZ.b $16,x
	LDY.w $77C2,x
	LDA.w DATA_019A2D,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$FA00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.b #$03
	STY.w $105E
	LDA.w #$0008
	STA.b $18,x
	STZ.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	RTS

CODE_019ABE:
	LDA.w $7A36,x
	BNE.b CODE_019B18
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STZ.w $7542,x
	LDA.w $75E0,x
	BNE.b CODE_019AE1
	LDA.w #$0020
	STA.w $7A96,x
	STA.w $75E0,x
	LDA.w #$000C
	STA.w $7720,x
	RTS

CODE_019AE1:
	LDA.w #$0060
	STA.w $7542,x
	LDA.w #$0800
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w $75E2,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_019B18
	LDA.w #$0003
	STA.b $16,x
	STZ.w $75E0,x
	LDA.w #$0020
	STA.w $61C8
	LDA.w #$0004
	STA.w $7A96,x
	STZ.w $1074
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	INC.b $76,x
CODE_019B18:
	RTS

;---------------------------------------------------------------------------

DATA_019B19:
	dw $FE00,$0200

DATA_019B1D:
	db $03,$10

DATA_019B1F:
	dw $0000,$FC00

;-------------------------------------------------------------------------
; State $4E: CODE_hookbill_hop_two. Continued hopping pattern. Each "down"
; hop, plays sound $47 + DEC $16. Final bounce sets $7A96 = $80, $1072 = 0,
; $7542 = $0040 drag, $75E2 = $0400 gravity, INC $76 (-> ground_pound).
; CALLERS: DATA_hookbill_state_ptr[39]
;-------------------------------------------------------------------------
CODE_019B23:
CODE_hookbill_hop_two:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_019BA3
	LDA.w $7A96,x
	BNE.b CODE_019BA3
	LDA.b $16,x
	AND.w #$0001
	BNE.b CODE_019B70
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0020
	STA.w $61C8
	LDA.w #$0004
	STA.w $7A96,x
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	DEC.b $16,x
	BPL.b CODE_019BA3
	LDA.w #$0080
	STA.w $7A96,x
	STZ.w $1072
	LDA.w #$0040
	STA.w $7542,x
	LDA.w #$0400
	STA.w $75E2,x
	STZ.w $7A38,x
	STZ.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	INC.b $76,x
	RTS

CODE_019B70:
	DEC.b $16,x
	LDA.b $16,x
	LSR
	TAY
	SEP.b #$20
	LDA.w DATA_019B1D,y
	STA.w $105E
	REP.b #$20
	LDY.b $16,x
	LDA.w DATA_019B1F,y
	STA.w $7A38,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w #$0008
	STA.b $18,x
	LDA.w #$F800
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDY.w $77C2,x
	LDA.w DATA_019B19,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	TYA
	STA.w $7400,x
CODE_019BA3:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $50 (also $64): CODE_hookbill_ground_pound_and_body_out. When
; grounded, $106E |= $FF00 (palette override), $107A = 0, $107E = $107C,
; $7A96 = $40, $7A98 = $80. If $76,x was $28 (special), JMP CODE_019BF4;
; else clear player state and $0B7B. Then $76,x = $01 (back to crawl).
; CALLERS: DATA_hookbill_state_ptr[40], DATA_hookbill_state_ptr[50]
;-------------------------------------------------------------------------
CODE_019BA4:
CODE_hookbill_ground_pound_and_body_out:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_019BF8
	LDA.b $16,x
	BEQ.b CODE_019BBD
	STZ.b $16,x
	LDY.b #$02
	STY.b $78,x
	STZ.w $105E
	LDA.w #$0008
	STA.b $18,x
	RTS

CODE_019BBD:
	LDA.w $7A36,x
	BNE.b CODE_019BF8
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_019BF8
	LDA.w $106E
	ORA.w #$FF00
	STA.w $106E
	STZ.w $107A
	LDY.w $107C
	STY.w $107E
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$0080
	STA.w $7A98,x
	LDY.b $76,x
	CPY.b #$28
	BEQ.b CODE_019BF4
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	STZ.w $0B7B
CODE_019BF4:
	LDY.b #$01
	STY.b $76,x
CODE_019BF8:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $52 (also $66): CODE_hookbill_ground_pounded_init. Player ground-
; pounded Hookbill. Sets $78 = $27 (squash anim), $105E = $15,
; $7A36 = $0001, $7A96 = $40 / $20. Each frame DECs $1078 by $0008
; (boss height) while still > $00C0. SuperFX FXCODE_0B86B6 runs to
; rescale the boss body to the new height; result -> $7720,x (body bbox).
; CALLERS: DATA_hookbill_state_ptr[41], DATA_hookbill_state_ptr[51]
;-------------------------------------------------------------------------
CODE_019BF9:
CODE_hookbill_ground_pounded_init:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019C23
	LDY.b $76,x
	CPY.b #$29
	BEQ.b CODE_019C19
	LDY.b #$27
	STY.b $78,x
	LDY.b #$15
	STY.w $105E
	LDA.w #$0001
	STA.w $7A36,x
	LDA.w #$0040
	BRA.b CODE_019C1E

CODE_019C19:
	STZ.b $16,x
	LDA.w #$0020
CODE_019C1E:
	STA.w $7A96,x
	INC.b $76,x
CODE_019C23:
	LDA.w $1078
	SEC
	SBC.w #$0008
	CMP.w #$00C0
	BMI.b CODE_019C4C
	STA.w $1078
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0012
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7720,x
CODE_019C4C:
	RTS

;---------------------------------------------------------------------------

DATA_019C4D:
	dw $FC00,$0400

;-------------------------------------------------------------------------
; State $54: CODE_hookbill_ground_pounded_flash. Bounces $1078 back up
; (re-grows boss). When $1078 >= $0101, applies KO physics:
;   - clears player state (out of cutscene)
;   - reads DATA_019C4D[y] (where y = 0 if Hookbill X>=$80 else 2),
;     writes camera-shake to $60A8 / $60B4 / $60AA / $60C0 / $60D2,
;     resets $61B4 (player hit counter), $1074 = $02, $16 = $02.
;   - $7A96 = $20, $78 = $18, $105E = $10, $76 = $24 (hop_wobble again).
; CALLERS: DATA_hookbill_state_ptr[42]
;-------------------------------------------------------------------------
CODE_019C51:
CODE_hookbill_ground_pounded_flash:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_019CC8
	LDA.w $1078
	CLC
	ADC.w #$0008
	CMP.w #$0101
	BMI.b CODE_019CAB
	STZ.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDY.b #$00
	LDA.w $7680,x
	CMP.w #$0080
	BPL.b CODE_019C72
	INY
	INY
CODE_019C72:
	LDA.w DATA_019C4D,y
	STA.w $60A8
	STA.w $60B4
	LDA.w #$FA00
	STA.w $60AA
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$8001
	STA.w $60D2
	STZ.w $61B4
	LDY.b #$02
	STY.w $1074
	STY.b $16,x
	LDA.w #$0020
	STA.w $7A96,x
	LDY.b #$18
	STY.b $78,x
	LDY.b #$10
	STY.w $105E
	LDY.b #$24
	STY.b $76,x
	RTS

CODE_019CAB:
	STA.w $1078
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0012
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	STA.w $7720,x
CODE_019CC8:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $56: CODE_hookbill_begin_koopa_walking. PRE-Hookbill state: the
; tiny koopa walks in from the right. When sprite X < $A0, $7402 = $08
; (face left), EXRAM XSpeed = 0, INC $1015 (boss-side seed of the
; Kamek-spell handshake at !RAM_YI_Level_KamekSpellHandshake; the
; CutsceneKamek sprite $048 in Bank0C wakes on non-zero, eventually
; writes $FFFF when its spell-throw cinema completes, and the next
; Hookbill state (begin_kamek) BPLs on $1015 until it goes negative),
; INC $76 (-> begin_kamek). Otherwise every $7A98 frames, cycles $7402
; anim 0..7. CALLERS: DATA_hookbill_state_ptr[43]
;-------------------------------------------------------------------------
CODE_019CC9:
CODE_hookbill_begin_koopa_walking:
	TYX
	LDA.w $7C16,x
	CMP.w #$00A0
	BPL.b CODE_019CE1
	LDA.w #$0008
	STA.w $7402,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	INC.w $1015
	INC.b $76,x
	RTS

CODE_019CE1:
	LDA.w $7A98,x
	BNE.b CODE_019CF6
	LDA.w #$0005
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	AND.w #$0007
	STA.w $7402,x
CODE_019CF6:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $58: CODE_hookbill_begin_kamek. Waits until Kamek's magic-throw
; sequence finishes ($1015 reads as negative -> positive transition);
; clears $1015, INC $76. CALLERS: DATA_hookbill_state_ptr[44]
;-------------------------------------------------------------------------
CODE_019CF7:
CODE_hookbill_begin_kamek:
	TYX
	LDA.w $1015
	BPL.b CODE_019D02
	STZ.w $1015
	INC.b $76,x
CODE_019D02:
	RTS

;---------------------------------------------------------------------------

DATA_019D03:
	dw $0000,$1000

DATA_019D07:
	dw $7000,$7000

DATA_019D0B:
	dw $00B7,$00B8

;-------------------------------------------------------------------------
; State $5A: CODE_hookbill_begin_init1. Streaming graphic-decompress phase
; for the GIANT Hookbill body. Loads compressed-graphic IDs from
; DATA_019D0B (one per pass), into VRAM page from DATA_019D03 + counter
; in $0C16. Each pass calls CODE_00B756 + CODE_00BF86 (decompress + DMA
; chunk). On final pass (count = 2), INC $76. Each chunk advances
; $0C18 (running VRAM offset) by $0800 per pass.
; CALLERS: DATA_hookbill_state_ptr[45]
;-------------------------------------------------------------------------
CODE_019D0F:
CODE_hookbill_begin_init1:
	REP.b #$10
	LDA.w #$0800
	STA.b $00
	LDA.w $0C16
	BNE.b CODE_019D61
	LDA.w $0C14
	CMP.w #$0002
	BCC.b CODE_019D2D
	STZ.w $0C18
	SEP.b #$10
	LDX.b $12
	INC.b $76,x
	RTS

CODE_019D2D:
	ASL
	TAY
	LDA.w DATA_019D03,y
	STA.w $0C18
	LDA.w #$6800
	STA.w $0C1A
	LDX.w DATA_019D07,y
	LDA.w DATA_019D0B,y
	JSL.l CODE_00B756
	STA.w $0C16
	INC.w $0C14
	PHA
	SEP.b #$10
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08AA5F>>16
	LDA.w #FXCODE_08AA5F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	PLA
	ASL
	STA.w $0C16
CODE_019D61:
	SEC
	SBC.w #$0800
	BCS.b CODE_019D6F
	ADC.w #$0800
	STA.b $00
	LDA.w #$0000
CODE_019D6F:
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
	JSL.l CODE_00BF86
	LDA.b $00
	CLC
	ADC.w $0C18
	STA.w $0C18
	SEP.b #$10
	LDX.b $12
	RTS

;---------------------------------------------------------------------------

DATA_019D99:
	db $00,$01,$02,$03,$04,$05,$06,$00
	db $10,$11,$12,$13,$14,$15,$16,$17
	db $20,$21,$22,$23,$24,$25,$26,$27
	db $30,$31,$32,$33,$34,$35,$36,$37
	db $40,$41,$42,$43,$44,$45,$46,$47
	db $00,$51,$52,$53,$54,$55,$56,$00
	db $00,$00,$62,$63,$64,$65,$00,$00

DATA_019DD1:
	db $00,$05 : dl $7E5040

DATA_019DD6:
	db $70,$07,$2B,$07,$01,$49,$00

DATA_019DDD:
	db $70,$11,$00,$2B,$11,$00,$01,$12
	db $00,$00

;-------------------------------------------------------------------------
; State $5C: CODE_hookbill_begin_init2. Continues VRAM upload from $0C18
; until $0C18 >= $4000. Each pass: JSL CODE_00BF4A ($0800 bytes per
; tick). When fully uploaded ($0C18 >= $4000), shifts to "Mode-7 boss
; setup":
;   - Loads sprite map data from DATA_019D99 (Hookbill's Mode-7 tilemap)
;     in 8 x 7 chunks via CODE_00BF16.
;   - Calls CODE_019291 (palette setup).
;   - Configures HDMA channel 6/7 from DATA_019DD1/D6/DD.
;   - Sets up Mode-7 matrix (A=D=$0100 identity, B=C=0).
;   - Sets Mode-7 center to $20/$1C.
;   - $011C = $0A, BG2 addr/size = $69, MainScreen = $12 (BG1+BG3 only
;     since Mode-7).
;   - $16,x = $04 (next-state countdown), YSpeed = $FD00, $7A98 = $0A.
;   - INC $76. CALLERS: DATA_hookbill_state_ptr[46]
;-------------------------------------------------------------------------
CODE_019DE7:
CODE_hookbill_begin_init2:
	REP.b #$10
	LDA.w $0C18
	CMP.w #$4000
	BCS.b CODE_019E07
	TAY
	ADC.w #$0800
	STA.w $0C18
	LDA.w #$0800
	LDX.w #$0000
	JSL.l CODE_00BF4A
	SEP.b #$10
	LDX.b $12
	RTS

CODE_019E07:
	LDA.w #$0000
	STA.b $00
	LDA.w #DATA_019D99
	STA.b $02
	LDA.w #DATA_019D99>>16
	STA.w $0001
	LDA.w #$0007
	STA.b $04
CODE_019E1C:
	LDY.b $00
	TYA
	CLC
	ADC.w #$0080
	STA.b $00
	LDX.b $02
	TXA
	CLC
	ADC.w #$0008
	STA.b $02
	LDA.w #$0008
	JSL.l CODE_00BF16
	DEC.b $04
	BNE.b CODE_019E1C
	SEP.b #$10
	JSR.w CODE_019291
	REP.b #$10
	SEP.b #$20
	LDX.w #$0004
CODE_019E45:
	LDA.w DATA_019DD1,x
	STA.w HDMA[$07].Parameters,x
	DEX
	BPL.b CODE_019E45
	LDX.w #$0009
CODE_019E51:
	LDA.w DATA_019DD6,x
	STA.l $7E5040,x
	LDA.w DATA_019DDD,x
	STA.l $7E51E4,x
	DEX
	BPL.b CODE_019E51
	LDA.b #$C0
	TSB.w !RAM_YI_Global_HDMAEnable
	LDA.b #$0A
	STA.w $011C
	LDA.b #$69
	STA.w !RAM_YI_Global_BG2AddressAndSize
	REP.b #$20
	LDA.w #$0012
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w #$0100
	STA.w !RAM_YI_Global_Mode7MatrixParameterALo
	STA.w !RAM_YI_Global_Mode7MatrixParameterDLo
	STZ.w !RAM_YI_Global_Mode7MatrixParameterBLo
	STZ.w !RAM_YI_Global_Mode7MatrixParameterCLo
	LDA.w #$0020
	STA.w !RAM_YI_Global_Mode7CenterXLo
	LDA.w #$001C
	STA.w !RAM_YI_Global_Mode7CenterYLo
	LDA.w #$0080
	STA.w !RAM_YI_Global_Layer3YPosLo
	SEP.b #$10
	LDX.b $12
	LDA.w #$0004
	STA.b $16,x
	LDA.w #$FD00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$000A
	STA.w $7A98,x
	INC.b $76,x
CODE_019EB1:
	RTS

;---------------------------------------------------------------------------

DATA_019EB2:
	db $0F,$0B,$0C,$0D

;-------------------------------------------------------------------------
; State $5E: CODE_hookbill_begin_koopa_crouch. Crouching anim before shell
; spawns. While $7A98 ticks, $16,x cycles through 4 facing frames
; (DATA_019EB2: $0F/$0B/$0C/$0D). When $16 < 0, sets up Mode-7 sprite
; via $6FA0/$6FA2/$7040 (sprite-2 OAM extension words), nudges Y up by 4,
; INC $1080 (boss is now in mid-animation phase 1), clears state regs,
; positions Hookbill at $1076/$1078 = $0050, calls CODE_018AC9/AB6/AE1/B15
; (set up SuperFX draw + Mode-7 matrix), INC $76. Final PLA + RTL
; terminates the dispatcher chain to skip post-state housekeeping.
; CALLERS: DATA_hookbill_state_ptr[47]
;-------------------------------------------------------------------------
CODE_019EB6:
CODE_hookbill_begin_koopa_crouch:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_019EB1
	DEC.b $16,x
	BMI.b CODE_019ED2
	LDY.b $16,x
	LDA.w DATA_019EB2,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
CODE_019ED1:
	RTS

CODE_019ED2:
	LDA.w $7860,x
	BEQ.b CODE_019ED1
	LDA.w #$6E6C
	STA.w $6FA0,x
	LDA.w #$2041
	STA.w $6FA2,x
	LDA.w #$A902
	STA.w $7040,x
	INC.w $1080
	LDA.w $70E2,x
	SEC
	SBC.w #$0002
	STA.w $70E2,x
	LDA.w $7182,x
	CLC
	ADC.w #$0004
	STA.w $7182,x
	STZ.b $18,x
	STZ.w $7A36,x
	STZ.w $7042,x
	STZ.b $16,x
	LDA.w #$0050
	STA.w $1076
	STA.w $1078
	JSR.w CODE_018AC9
	JSR.w CODE_018AB6
	JSR.w CODE_018AE1
	JSR.w CODE_018B15
	INC.w $0CF9
	LDX.b $12
	INC.w $1070
	LDA.w #$0001
	STA.w $106E
	INC.w $1072
	LDA.w #$FFFE
	STA.w $7720,x
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STZ.w $7A38,x
	STZ.w $7A36,x
	LDA.w #$0025
	STA.w $7402,x
	TAY
	STY.b $78,x
	LDY.b #$12
	STY.w $105C
	STY.w $105E
	INC.b $76,x
	PLA
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $60: CODE_hookbill_begin_shell_init. Player-controllable Yoshi waits
; for ground touch ($7860&1) -> $16 = $10 (shell-grow counter),
; INC $105E, $18 = $18, sound $87 (castle-about-to-explode), INC $76.
; CALLERS: DATA_hookbill_state_ptr[48]
;-------------------------------------------------------------------------
CODE_019F57:
CODE_hookbill_begin_shell_init:
	TYX
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_019F79
	LDA.w #$0010
	STA.b $16,x
	STZ.w $7A36,x
	INC.w $105E
	LDA.w #$0018
	STA.b $18,x
	LDA.w #!Define_YI_SoundID87_CastleAboutToExplode
	JSL.l CODE_push_sound_queue
	INC.b $76,x
CODE_019F79:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $62: CODE_hookbill_begin_shell_grow. The MOMENT-OF-TRUTH state.
; Hookbill's shell grows around him via SuperFX scaling. Each frame:
;   - DEC $16; while $16 > -1, animates the shell-growing.
;   - When $16 < -1: $1072 = 0, $7A96 = $80, INC $76 (-> ground_pound),
;     which IS the combat engagement. Combat state machine is now LIVE.
;   - $1076 / $1078 ramp from current value to $0100 over time via
;     SuperFX FXCODE_0B86B6. Result -> $7720,x (body bbox).
; CALLERS: DATA_hookbill_state_ptr[49]
;-------------------------------------------------------------------------
CODE_019F7A:
CODE_hookbill_begin_shell_grow:
	TYX
	LDA.w $7A36,x
	BNE.b CODE_019FB1
	LDA.b $16,x
	BPL.b CODE_019F90
	STZ.w $1072
	LDA.w #$0080
	STA.w $7A96,x
	INC.b $76,x
	RTS

CODE_019F90:
	DEC.b $16,x
	BPL.b CODE_019F9B
	INC.b $78,x
	LDA.w #$0012
	BRA.b CODE_019FA6

CODE_019F9B:
	LDA.b $16,x
	AND.w #$0001
	ASL
	DEC
	CLC
	ADC.w $105E
CODE_019FA6:
	STA.w $105E
	LDA.w #$0018
	STA.b $18,x
	STZ.w $7A36,x
CODE_019FB1:
	LDA.w $1076
	CLC
	ADC.w #$0001
	CMP.w #$0100
	BMI.b CODE_019FC0
	LDA.w #$0100
CODE_019FC0:
	STA.w $1076
	STA.w $1078
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #$0016
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w #$0008
	STA.w $7720,x
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $68: CODE_hookbill_dead_squish_down. The TERMINAL death sequence
; begin. Sets $16,x = $0A (pancake-tick count), INC $0B59 (death-
; counter), INC $105C, INC $76. Snapshots position to $00/$02, calls
; CODE_02E1A6 to queue large-area screen-shake ($340 frames worth).
; CALLERS: DATA_hookbill_state_ptr[52]
;-------------------------------------------------------------------------
CODE_019FE5:
CODE_hookbill_dead_squish_down:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_01A014
	LDA.w $7A36,x
	BNE.b CODE_01A00F
	LDA.w #$000A
	STA.b $16,x
	INC.w $0B59
	INC.w $105C
	INC.b $76,x
	LDA.w $70E2,x
	STA.b $00
	LDA.w $7182,x
	STA.b $02
	LDA.w #$0340
	JSL.l CODE_02E1A6
	RTS

CODE_01A00F:
	LDA.w #$0008
	STA.b $18,x
CODE_01A014:
	RTS

;---------------------------------------------------------------------------

DATA_01A015:
	dw $0003,$FFFE,$0002,$FFFF,$0001

DATA_01A01F:
	dw $FFFD,$0002,$FFFE,$0001,$FFFF

DATA_01A029:
	dw $0004,$0008,$000E,$0014,$001C,$0020,$0028,$002C

DATA_01A039:
	dw $FFFC,$FFF8,$0000,$FFF0,$FFF4,$0008,$0002,$FFFC

DATA_01A049:
	dw $0000,$0001,$0002,$0001,$0000,$0001,$0000,$0002

DATA_01A059:
	dw $0100,$0480,$0180,$0300,$01C0,$0240,$0080,$0200
	dw $FD00,$FF00,$FE00,$F840,$FD80,$FF80,$FAC0,$FE80

DATA_01A079:
	dw $FA00,$FD80,$FC00,$FF80,$FC80,$FB00,$F780,$FE00
	dw $FB80,$FF00,$F800,$FB00,$FE80,$FD00,$FB80,$FA80

;-------------------------------------------------------------------------
; State $6A: CODE_hookbill_dead_pancake. Hookbill IS flat. Per frame, DEC $16
; by 2, alternates between scale-grow/shrink via DATA_01A015 / 01A01F.
; Each tick, uses SuperFX FXCODE_0B86B6 to update $1076/$1078 (X/Y scale)
; and writes new bbox to $7720,x.
; When $16 < -1: SHELL-BREAK preamble. Snapshots position to $1084/$1086,
; INC $1080 (phase=2), spawns 16 debris "stars" (AmbSpr $223) at
; positions/velocities from DATA_01A029 + DATA_01A039 + DATA_01A049 +
; DATA_01A059 + DATA_01A079 (X/Y offsets, X/Y velocities, palette
; offsets), each with $73C2 (palette flag) set per slot. Plays sound
; $47 once for the big bang. Sets Mode-7 sprite OAM to "broken shell"
; tiles ($6FA0 = $6E6C, $6FA2 = $2040, $7040 = $3101). INC $76.
; CALLERS: DATA_hookbill_state_ptr[53]
;-------------------------------------------------------------------------
CODE_01A099:
CODE_hookbill_dead_pancake:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_01A0FD
	LDA.w $7A98,x
	BNE.b CODE_01A0B7
	DEC.b $16,x
	DEC.b $16,x
	BMI.b CODE_01A0FE
	BNE.b CODE_01A0B1
	LDA.w #$0040
	BRA.b CODE_01A0B4

CODE_01A0B1:
	LDA.w #$0020
CODE_01A0B4:
	STA.w $7A98,x
CODE_01A0B7:
	LDA.b $16,x
	BNE.b CODE_01A0C7
	LDA.w $7974
	AND.w #$0001
	BNE.b CODE_01A0FD
	LDY.b #$04
	BRA.b CODE_01A0CB

CODE_01A0C7:
	AND.w #$0002
	TAY
CODE_01A0CB:
	LDA.w DATA_01A015,y
	CLC
	ADC.w $1076
	STA.w $1076
	LDA.w DATA_01A01F,y
	CLC
	ADC.w $1078
	STA.w $1078
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #$0016
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_0B86B6>>16
	LDA.w #FXCODE_0B86B6
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	LDA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEC
	SBC.w #$0008
	STA.w $7720,x
CODE_01A0FD:
	RTS

CODE_01A0FE:
	LDA.w $70E2,x
	STA.w $1084
	LDA.w $7182,x
	STA.w $1086
	INC.w $1080
	LDA.w #FXDATA_548000+$60A1
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$60A1)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
	LDA.w #$0010
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$0100
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_088293>>16
	LDA.w #FXCODE_088293
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0CF9
	LDX.b $12
	LDA.w #$6E6C
	STA.w $6FA0,x
	LDA.w #$2040
	STA.w $6FA2,x
	LDA.w #$3101
	STA.w $7040,x
	LDA.w #$000C
	STA.w $7402,x
	LDA.w #$FB00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$000A
	STA.w $7542,x
	LDA.w #$0020
	STA.w $7042,x
	LDA.w #$001E
CODE_01A169:
	STA.b $00
	TAY
	LDA.w DATA_01A059,y
	STA.b $04
	LDA.w DATA_01A079,y
	STA.b $08
	TYA
	BIT.w #$0010
	BNE.b CODE_01A181
	LDA.w DATA_01A029,y
	BRA.b CODE_01A18C

CODE_01A181:
	AND.w #$000E
	TAY
	LDA.w DATA_01A029,y
	EOR.w #$FFFF
	INC
CODE_01A18C:
	STA.b $02
	LDA.w DATA_01A039,y
	STA.b $06
	LDA.w DATA_01A049,y
	STA.b $0A
	LDA.w #!Define_YI_AmbSpr223
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $1084
	CLC
	ADC.b $02
	STA.w $70A2,y
	LDA.w $1086
	CLC
	ADC.b $06
	STA.w $7142,y
	LDA.w #$0080
	STA.w $7782,y
	LDA.b $04
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.b $08
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$0004
	STA.w $7500,y
	LDA.b $0A
	STA.w $73C2,y
	LDA.b $00
	DEC
	DEC
	BPL.b CODE_01A169
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	INC.b $76,x
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $6C: CODE_hookbill_dead_shell_break. Falls the corpse into the floor
; from the screen-edge. If $7223 (sprite-collision flag) signed bit
; clear and shell-flag bit 7 of $7042 NOT yet set: sets bit 7,
; $7542 = $0010 (drag), $70E2 = $6094 + $0080 (drop X-pos at far
; right), $7182 = $609C - $0018 (drop Y), YSpeed = $0400 (down),
; sound $82 (boss falling). Then waits for $7683,x to expire (DEY),
; $7A96 = $60, INC $76. CALLERS: DATA_hookbill_state_ptr[54]
;-------------------------------------------------------------------------
CODE_01A1DC:
CODE_hookbill_dead_shell_break:
	TYX
	LDY.w $7223,x
	BMI.b CODE_01A225
	LDA.w $7042,x
	BIT.w #$0080
	BNE.b CODE_01A217
	ORA.w #$0080
	STA.w $7042,x
	LDA.w #$0010
	STA.w $7542,x
	LDA.w $6094
	CLC
	ADC.w #$0080
	STA.w $70E2,x
	LDA.w $609C
	SEC
	SBC.w #$0018
	STA.w $7182,x
	LDA.w #$0400
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #!Define_YI_SoundID82_BossFalling
	JSL.l CODE_push_sound_queue
CODE_01A217:
	LDY.w $7683,x
	DEY
	BMI.b CODE_01A225
	LDA.w #$0060
	STA.w $7A96,x
	INC.b $76,x
CODE_01A225:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; State $6E: CODE_hookbill_final. THE END. When $7A96 expires:
;   - Clears HDMA channels 7+6 (TRB #$C0).
;   - $011C = 2, MainScreen = $0011 (BG1 + sprite, NO Mode-7 BG2).
;   - $7ECC = 0.
;   - PLA + JML.l CODE_despawn_sprite_free_slot (the universal "boss defeated --
;     queue closer-wall sprite, free this slot"). This consumes the
;     dispatcher return address and exits the entire boss state
;     machine for good. CALLERS: DATA_hookbill_state_ptr[55]
;-------------------------------------------------------------------------
CODE_01A226:
CODE_hookbill_final:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_01A225
	SEP.b #$20
	LDA.b #$C0
	TRB.w !RAM_YI_Global_HDMAEnable
	REP.b #$20
	LDY.b #$02
	STY.w $011C
	LDA.w #$0011
	STA.w !RAM_YI_Global_MainScreenLayers
	STZ.w $7ECC
	PLA
	JML.l CODE_despawn_sprite_free_slot

;---------------------------------------------------------------------------

;=========================================================================
; NAVAL PIRANHA CLOSING WALL / BOSS-FIGHT CLOSER (sprite $0DD).
; Raidenthequick: init_boss_closer / main_boss_closer / DATA_boss_closer_ptr.
; See also: ys_boss1.asm / ys_boss2.asm (parallel boss conventions).
; Deep dive: docs/bossengine.md section 5 (closer-cinematic state diagram).
;
; "Closer" is a stage closer cinematic sprite -- it sequences the
; camera, spawns map16 effects (salvo of smoke/coins), and triggers the
; next room transition. Used after both Naval Piranha and Hookbill.
; State $18,x picks an 8-entry state ptr (DATA_boss_closer_ptr).
;=========================================================================

;-------------------------------------------------------------------------
; Init: trivial RTL -- this sprite needs no init beyond default sprite
; spawn (state $18 already 0 = first closer entry).
;
; INPUTS:   X = sprite slot
; OUTPUTS:  (none)
; CALLERS:  Sprite Init dispatcher (when closer-wall sprite spawns
;           via CODE_despawn_sprite_free_slot from a boss's final state).
;-------------------------------------------------------------------------
YI_NorSpr0DD_CloseWallInNavalPiranhaRoom_Init:
init_boss_closer:                       ; Raidenthequick: init_boss_closer
;$01A248
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Closer cinematic state pointers (8 entries) -- consumed by Main below.
;-------------------------------------------------------------------------
DATA_01A249:
DATA_boss_closer_ptr:                        ; Raidenthequick: DATA_boss_closer_ptr
	dw CODE_closer_wait                      ; 00 CODE_closer_wait      -- pause N frames
	dw CODE_closer_camera_1                      ; 02 CODE_closer_camera_1  -- pan camera step 1
	dw CODE_closer_camera_2                      ; 04 CODE_closer_camera_2  -- pan camera step 2
	dw CODE_closer_arena                      ; 06 CODE_closer_arena     -- arrived at arena
	dw CODE_closer_finish                      ; 08 CODE_closer_finish    -- end closer
	dw CODE_closer_salvo                      ; 0A CODE_closer_salvo     -- spawn map16 salvo effects
	dw CODE_closer_naval                      ; 0C CODE_closer_naval     -- Naval Piranha-specific
	dw CODE_closer_hookbill                      ; 0E CODE_closer_hookbill  -- Hookbill-specific

DATA_01A259:
	dw $0005,$FFFF,$01A0,$0760,$0000,$0000,$0020,$0000
	dw $0002,$FFFF,$00C0,$01A0,$0001,$0003,$0001,$01A0
	dw $7FFF,$0004,$0001,$0006,$FFFF,$02B0,$07D0,$0005
	dw $0002,$FFFF,$00C0,$02B0,$0001,$0003,$0001,$02B0
	dw $02F0,$0000,$0002,$0000,$0001,$FFFF,$0080,$0000
	dw $0020,$0000,$0007,$FFFF,$0000,$0000,$0001,$0100
	dw $0000,$0020,$0000,$0001,$FFFF,$0020,$0004,$0001
	dw $0020,$00B0

DATA_01A2CD:
	db $06,$06,$0A,$08,$04,$0A,$0A,$06

;-------------------------------------------------------------------------
; Closer Main. Runs shared sprite housekeeping ($03AF23), checks the
; timer at $7A96,x (return early if still ticking), seeds boss-fight
; positions from the DATA_01A259 parameter table, sets the player
; state, then dispatches via DATA_boss_closer_ptr on $18,x.
;
; State byte: $18,x. Each closer step reads the row at
;   DATA_01A259 + $18,x  (8-byte rows packed by closer_camera type)
; and advances $18,x by DATA_01A2CD[state] bytes per step (6 or 8).
;
; INPUTS:   X = sprite slot; $18,x = current step row offset;
;           $7A96,x = timer (decremented externally);
;           $701902,x = end-of-script sentinel
; OUTPUTS:  Camera scroll, player state, OAM for boss debris;
;           on completion, JML CODE_03A31E (kill self).
; MODIFIES: A, X, Y, all closer-internal sprite WRAM.
; CALLERS:  Bank03 sprite-list traversal (gamemode $0F).
;-------------------------------------------------------------------------
YI_NorSpr0DD_CloseWallInNavalPiranhaRoom_Main:
main_boss_closer:                       ; Raidenthequick: main_boss_closer
;$01A2D5
	JSL.l CODE_03AF23                   ; shared sprite housekeeping
	LDA.w $7A96,x                       ; \ timer still ticking?
	BNE.b CODE_01A324                   ; / if yes, branch to per-tick update
	STZ.w $617A
	STZ.w $617C
	LDA.b $18,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_01A2F5
	LDA.w #!Define_YI_PlayerState00_Normal
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	JML.l CODE_03A31E

CODE_01A2F5:
	REP.b #$10
	LDY.b $18,x
	LDA.w DATA_01A259,y
	STA.b $76,x
	LDA.w DATA_01A259+$04,y
	STA.b $78,x
	LDA.w DATA_01A259+$06,y
	STA.w $7A36,x
	LDA.w DATA_01A259+$08,y
	STA.w $7A38,x
	LDA.w DATA_01A259+$02,y
	STA.w $7A96,x
	LDY.b $76,x
	LDA.w DATA_01A2CD,y
	AND.w #$00FF
	CLC
	ADC.b $18,x
	STA.b $18,x
	SEP.b #$10
CODE_01A324:
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_boss_closer_ptr,x)
	RTL

;-------------------------------------------------------------------------
; Closer state $00: CODE_closer_wait. Writes $78,x (countdown) to
; $617A/$617C (camera-pin-X-left/right) and returns. Used as a
; "hold this position" beat between camera pans.
;-------------------------------------------------------------------------
CODE_01A32D:
CODE_closer_wait:
	TYX
	LDA.b $78,x
	STA.w $617A
	STA.w $617C
	RTS

;-------------------------------------------------------------------------
; Closer state $02: CODE_closer_camera_1. Locks player to in-cutscene state,
; pans Layer1XPos toward $60B0 by 1px/frame. When position matches
; $78,x (target), zeros $7A96 to advance the closer.
;-------------------------------------------------------------------------
CODE_01A337:
CODE_closer_camera_1:
	TYX
	STY.w $0C1E
	LDA.w #!Define_YI_PlayerState02_InCutscene
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.w $60B0
	CMP.b $78,x
	BNE.b CODE_01A34C
	STZ.w $7A96,x
	RTS

CODE_01A34C:
	BPL.b CODE_01A353
	DEC.w !RAM_YI_Global_Layer1XPosLo
	BRA.b CODE_01A356

CODE_01A353:
	INC.w !RAM_YI_Global_Layer1XPosLo
CODE_01A356:
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $0C23
	RTS

;-------------------------------------------------------------------------
; Closer state $04: CODE_closer_camera_2. Pans by $78,x per frame instead of
; 1px/frame, with wrap-around at $0100. When $7A36,x sign-bit changes
; vs $7A38,x (XOR), the pan is complete -> zero $7A96 and $0C1E to
; release player.
;-------------------------------------------------------------------------
CODE_01A35D:
CODE_closer_camera_2:
	TYX
	STY.w $0C1E
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CLC
	ADC.b $78,x
CODE_01A367:
	CMP.w #$0100
	BMI.b CODE_01A392
	SEC
	SBC.w #$0100
	PHA
	LDA.w !RAM_YI_Global_Layer1XPosLo
	SEC
	SBC.w $7A36,x
	EOR.w $7A38,x
	BMI.b CODE_01A385
	PLA
	STZ.w $7A96,x
	STZ.w $0C1E
	RTS

CODE_01A385:
	LDA.w !RAM_YI_Global_Layer1XPosLo
	CLC
	ADC.w $7A38,x
	STA.w !RAM_YI_Global_Layer1XPosLo
	PLA
	BRA.b CODE_01A367

CODE_01A392:
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $0C23
	RTS

;-------------------------------------------------------------------------
; Closer state $06: CODE_closer_arena. Locks the camera at $78,x / $7A36,x by
; writing them to $7E18 / $7E1A (Layer1 left/right edge clamps).
;-------------------------------------------------------------------------
CODE_01A39C:
CODE_closer_arena:
	TYX
	LDA.b $78,x
	STA.w $7E18
	LDA.w $7A36,x
	STA.w $7E1A
CODE_01A3A8:
CODE_closer_return_1:
	RTS

;-------------------------------------------------------------------------
; Closer state $08: CODE_closer_finish. INC $105A (room-cleared flag), then
; PLA + JML CODE_03A31E (remove this sprite, exits boss-room logic).
;-------------------------------------------------------------------------
CODE_01A3A9:
CODE_closer_finish:
	TYX
	INC.w $105A
	PLA
	JML.l CODE_03A31E

DATA_01A3B2:
DATA_closer_salvo_timer:
	dw $0020,$0000,$001F,$0020,$0020

DATA_01A3BC:
DATA_closer_salvo_map16:
	dw $015C,$015A,$015B,$015C,$015C

DATA_01A3C6:
DATA_closer_salvo_x_offset:
	dw $0000,$0010,$FFF0,$0010,$FFF0

DATA_01A3D0:
DATA_closer_salvo_y_offset:
	dw $0000,$0000,$0010,$0000,$0010

DATA_01A3DA:
DATA_closer_salvo_smoke:
	dw $0001,$0000,$0001,$0001,$0001

;-------------------------------------------------------------------------
; Closer state $0A: CODE_closer_salvo. Spawns a "salvo" (multi-tile map16
; stamp + ambient sprite explosions). Reads 5 parameter tables
; (DATA_closer_salvo_timer / _map16 / _x_offset / _y_offset / _smoke)
; per "shot" indexed by $7A38,x; stamps map16 tiles via CODE_change_map16
; (Bank10 sprite stamp), and spawns AmbSpr $1E6 (explosion smoke).
; When 5 shots fired (== reach $07B0/$01A0 sentinel), zero $7A96 to
; advance the closer.
;-------------------------------------------------------------------------
CODE_01A3E4:
CODE_closer_salvo:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_closer_return_1
	LDY.w $7A38,x
	LDA.w DATA_closer_salvo_timer,y
	STA.w $7A98,x
	LDA.w DATA_closer_salvo_smoke,y
	PHP
	LDA.w $7A36,x
	STA.w $0093
	CLC
	ADC.w DATA_closer_salvo_y_offset,y
	STA.w $7A36,x
	LDA.b $78,x
	STA.w $0091
	CLC
	ADC.w DATA_closer_salvo_x_offset,y
	STA.b $78,x
	LDA.w DATA_closer_salvo_map16,y
	STA.w $0095
	LDA.w #$0001
	STA.w $008F
	JSL.l CODE_change_map16
	LDX.b $12
	LDA.w $7A36,x
	CMP.w #$07B0
	BNE.b CODE_01A433
	LDA.b $78,x
	CMP.w #$01A0
	BNE.b CODE_01A433
	STZ.w $7A96,x
CODE_01A433:
	LDA.w $7A38,x
	INC
	INC
	CMP.w #$000A
	BMI.b CODE_01A440
	LDA.w #$0000
CODE_01A440:
	STA.w $7A38,x
	PLP
	BEQ.b CODE_closer_return_2
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.w #!Define_YI_AmbSpr1E6
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $0091
	CLC
	ADC.w #$0008
	STA.w $70A2,y
	LDA.w $0093
	CLC
	ADC.w #$0008
	STA.w $7142,y
	LDA.w #$0004
	STA.w $7782,y
	LDA.w #$0006
	STA.w $73C2,y
	STA.w $7E4C,y
CODE_01A477:
CODE_closer_return_2:
	RTS

DATA_01A478:
DATA_naval_map16:
	db $78,$79,$79,$79,$7A,$79,$7B,$79
	db $00,$00,$3C,$79,$3D,$79,$3E,$79
	db $3F,$79,$40,$79,$42,$79,$43,$79
	db $00,$00,$3C,$79

;-------------------------------------------------------------------------
; Closer state $0C: CODE_closer_naval. Naval-Piranha-specific closing
; cinematic. Stamps a 28-byte tile sequence (DATA_naval_map16)
; column-by-column to grow the closing wall. Each step DECs $7A38 (column
; counter); when 0, $7A96 = 0, INC $105A.
;-------------------------------------------------------------------------
CODE_01A494:
CODE_closer_naval:
	TYX
	LDA.w $7AF8,x
	BNE.b CODE_closer_return_2
	LDA.w #$0020
	STA.w $7AF8,x
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.b $78,x
	STA.w $0091
	STA.b $04
	LDA.w $7A36,x
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.w #$0006
	SEC
	SBC.w $7A38,x
	ASL
	ASL
	CLC
	ADC.w #$0008
	STA.b $00
	STA.b $02
CODE_01A4CB:
	LDA.b $02
	SEC
	SBC.b $00
	TAY
	LDA.w DATA_naval_map16,y
	STA.w $0095
	JSL.l CODE_change_map16
	LDA.w $0091
	CLC
	ADC.w #$0010
	STA.w $0091
	LDA.b $00
	AND.w #$0002
	BEQ.b CODE_01A4FB
	LDA.b $04
	STA.w $0091
	LDA.w $0093
	CLC
	ADC.w #$0010
	STA.w $0093
CODE_01A4FB:
	DEC.b $00
	DEC.b $00
	BNE.b CODE_01A4CB
	LDX.b $12
	LDA.w $7A36,x
	SEC
	SBC.w #$0010
	STA.w $7A36,x
	DEC.w $7A38,x
	BNE.b CODE_closer_return_3
	STZ.w $60A8
	STZ.w $60B4
	STZ.w $7A96,x
	INC.w $105A
CODE_01A51E:
CODE_closer_return_3:
	RTS

;-------------------------------------------------------------------------
; Closer state $0E: CODE_closer_hookbill. Hookbill-specific closing
; cinematic. Stamps a 2x2 grid of "rising platform" map16 tiles below
; the player at Y = Layer1YPos + $B0, and spawns AmbSpr $20C (the
; rising-platform AmbSpr). On each pass, decrements $701900,x; when 0,
; $7A96 = 0 and closer advances.
;-------------------------------------------------------------------------
CODE_01A51F:
CODE_closer_hookbill:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_closer_return_3
	LDA.b $78,x
	BNE.b CODE_01A541
	LDA.w #$0003
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w !RAM_YI_Global_Layer1XPosLo
	AND.w #$FFE0
	STA.b $78,x
	LDA.w !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w #$00B0
	STA.w $7A36,x
CODE_01A541:
	LDA.b $78,x
	STA.w $0091
	LDA.w $7A36,x
	STA.w $0093
	LDA.w #$0001
	STA.w $008F
	LDA.w #$0000
	STA.w $0095
	JSL.l CODE_change_map16
	LDA.w $0093
	CLC
	ADC.w #$0010
	STA.w $0093
	JSL.l CODE_change_map16
	LDA.w $0091
	CLC
	ADC.w #$0010
	STA.w $0091
	JSL.l CODE_change_map16
	LDA.w $0093
	SEC
	SBC.w #$0010
	STA.w $0093
	JSL.l CODE_change_map16
	LDX.b $12
	LDA.w #!Define_YI_AmbSpr20C
	JSL.l CODE_spawn_ambient_sprite
	LDA.b $78,x
	STA.w $70A2,y
	LDA.w $7A36,x
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.w #$000D
	STA.w $73C2,y
	LDA.w #$0036
	STA.w $7002,y
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	BNE.b CODE_01A5BC
	STZ.w $7A96,x
	RTS

CODE_01A5BC:
	LDA.w #$0010
	STA.w $7A98,x
	ASL
	CLC
	ADC.b $78,x
	STA.b $78,x
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; GEORGETTE JELLY (sprite $111) -- world 6 mid-boss-ish wobbling jelly.
; Has a 6-state Main dispatch (DATA_01A5E0). State $76,x picks form.
; Companion sprite Jelly Goo ($112) follows immediately below.
;=========================================================================

;-------------------------------------------------------------------------
; Georgette Jelly Init.
; Self-replicates "Georgette" type from one slot to another: when
; $701900,x == $701902,x (paired), DEC $701900, $76,x = X (slot),
; $7A98,x = $0002, INC $7402,x (advance facing).
;
; INPUTS:   X = sprite slot
; OUTPUTS:  $76,x, $7A98,x, $7402,x initialised
; CALLERS:  Sprite Init dispatcher for sprite $111.
;-------------------------------------------------------------------------
YI_NorSpr111_GeorgetteJelly_Init:
init_flan:                              ; Raidenthequick: init_flan
;$01A5C9
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	CMP.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BNE.b CODE_01A5DF
	DEC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.b $76,x
	LDA.w #$0002
	STA.w $7A98,x
	INC.w $7402,x
CODE_01A5DF:
	RTL

;---------------------------------------------------------------------------

DATA_01A5E0:
	dw CODE_01A830
	dw CODE_01A889
	dw CODE_01A8C0
	dw CODE_01A8F2
	dw CODE_01AA1F
	dw CODE_01AA6B

;-------------------------------------------------------------------------
; Georgette Jelly Main. 6-state machine via DATA_01A5E0.
; Calls CODE_georgette_jelly_per_frame_l (frozen/fuzzy-aware sprite update), then
; CODE_01A740 (per-frame egg/projectile damage detector + Yoshi
; bounce / mount logic), then dispatches state via DATA_01A5E0 on
; $76,x. Final step writes OAM attr $6FA0 = $0620 (small) or $0660
; (large) based on $76,x range.
;
; INPUTS:   X = slot; $76,x = state; $7A36/$7A96/$7A98 timers
; OUTPUTS:  Per-state behaviour; OAM updated
; CALLERS:  Bank03 sprite-list traversal.
;-------------------------------------------------------------------------
YI_NorSpr111_GeorgetteJelly_Main:
main_flan:                              ; Raidenthequick: main_flan
;$01A5EC
	JSL.l CODE_georgette_jelly_per_frame_l
	JSR.w CODE_01A740
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_01A5E0,x)
	LDA.w #$0620
	LDY.b $76,x
	CPY.b #$02
	BMI.b CODE_01A607
	LDA.w #$0660
CODE_01A607:
	STA.w $6FA0,x
	RTL

CODE_01A60B:
CODE_georgette_jelly_per_frame_l:              ; JSL-callable Georgette Jelly housekeeping: bail (pull caller) if freeze active; else run SuperFX FXCODE_099011 (per-sprite damage scan), kill any caught sprite via CODE_kill_sprite_by_hit_checked, handle ground/wall collisions
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_01A619
	PLY
	PLA
	RTL

CODE_01A619:
	LDA.w $6FA2,x
	AND.w #$FFE1
	LDY.w $7D38,x
	BNE.b CODE_01A62D
	ORA.w #$0008
	STA.w $6FA2,x
	JMP.w CODE_01A715

CODE_01A62D:
	STA.w $6FA2,x
	STZ.b $0E
	TXA
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_099011>>16
	LDA.w #FXCODE_099011
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
CODE_01A63F:
	LDX.b $12
	LDY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	BMI.b CODE_01A6A0
	BEQ.b CODE_01A6A0
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_01A6B9
	LDA.w $6FA2,y
	AND.w #$0800
	BEQ.b CODE_01A6A0
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr109_BronzeTapTap
	BEQ.b CODE_01A6A0
	CMP.w #!Define_YI_NorSpr10A_SilverTapTap
	BEQ.b CODE_01A6A0
	CMP.w #!Define_YI_NorSpr10B_HoppingSilverTapTap
	BEQ.b CODE_01A6A0
	PHY
	TYX
	JSL.l CODE_kill_sprite_by_hit_checked
	PLY
	LDA.w #$0000
	STA.w $7540,y
	LDA.w #$FE00
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,y
	INC.b $0E
	LDX.b $12
	LDA.w #$0040
	STA.w $7542,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	CMP.w #$8000
	ROR
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,y
	JSL.l CODE_03B53D
	LDX.b #FXCODE_09906B>>16
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	BRA.b CODE_01A63F

CODE_01A6A0:
	LDY.b $0E
	BEQ.b CODE_01A6B9
CODE_01A6A4:
	TXY
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	JSL.l CODE_spawn_sprite
	LDA.w #CODE_spr_state_init_entry
	STA.b $00
	LDA.w #CODE_spr_state_init_entry>>16
	STA.b $02
	JMP.w [$7960]

CODE_01A6B9:
	LDA.w $7860,x
	AND.w #$000C
	BEQ.b CODE_01A6C9
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	INC.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	BRA.b CODE_01A6A4

CODE_01A6C9:
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_01A6F7
	JSL.l CODE_03A590
	LDA.b $18,x
	CMP.w #$0002
	BCC.b CODE_01A6E9
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_01A6EB
	LDA.w $7A96,x
	BEQ.b CODE_01A6A4
	PLY
	PLA
	RTL

CODE_01A6E9:
	INC.b $18,x
CODE_01A6EB:
	LDA.w #$FD80
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	LDA.w #$0040
	STA.w $7542,x
CODE_01A6F7:
	LDA.w $7A98,x
	AND.w #$0003
	BNE.b CODE_01A712
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	AND.w #$0003
	ORA.w #$0004
	STA.w $7402,x
CODE_01A712:
	PLY
	PLA
CODE_01A714:
	RTL

CODE_01A715:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$0010
	BEQ.b CODE_01A714
	CMP.w #$0008
	BNE.b CODE_01A73D
	LDY.w $74A2,x
	BPL.b CODE_01A73D
	LDA.w $6FA2,x
	AND.w #$FCFF
	STA.w $6FA2,x
	LDA.w #$0002
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	ASL
	STA.w $7402,x
CODE_01A73D:
	PLY
	PLA
	RTL

CODE_01A740:
	LDY.w $7402,x
	CPY.b #$04
	BPL.b CODE_01A7A0
	LDY.w $7D36,x
	BPL.b CODE_01A7A1
	LDY.b $76,x
	CPY.b #$03
	BPL.b CODE_01A7A0
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF8
	BCC.b CODE_01A79C
	LDY.w $60C0
	BEQ.b CODE_01A7A0
	LDY.w $60AB
	BMI.b CODE_01A7A0
	STZ.w $60A8
	STZ.w $60B4
	STZ.w $60AA
	STZ.w $60D4
	INC.w $61B4
	LDA.w $7182,x
	CLC
	ADC.w #$FFE8
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	INC.w $7A36,x
CODE_01A788:
	STZ.b $16,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7A98,x
	LDY.b #$03
	STY.b $76,x
	LDA.w #!Define_YI_SoundID5F_Splash1
	JSL.l CODE_push_sound_queue
	RTS

CODE_01A79C:
	JSL.l CODE_03A858
CODE_01A7A0:
	RTS

CODE_01A7A1:
	BEQ.b CODE_01A7A0
	LDA.w $7AF6,x
	BNE.b CODE_01A7A0
	LDA.w $7D37,y
	BEQ.b CODE_01A7A0
	LDA.w $7541,y
	CMP.w #$0040
	BMI.b CODE_01A788
	LDA.b $76,x
	CMP.w #$0001
	BEQ.b CODE_01A7DA
	CMP.w #$0003
	BEQ.b CODE_01A7DA
	LDA.w #$0001
	STA.b $76,x
	STZ.w $7402,x
	STZ.b $16,x
	LDA.w #$0003
	STA.w $7A98,x
	PHY
	LDA.w #!Define_YI_SoundID13_SpringBounce
	JSL.l CODE_push_sound_queue
	PLY
CODE_01A7DA:
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$FE00
	STA.w $7221,y
	LDA.w $721F,y
	CLC
	ADC.w #$0080
	CMP.w #$0100
	BCS.b CODE_01A812
	LDA.w #$0010
	STA.w $7A96,x
	ASL
	STA.w $7AF6,x
	LDA.w #$FC00
	STA.w $7221,y
	LDA.w $7400,x
	DEC
	PHP
	LDA.w #$FE00
	PLP
	BPL.b CODE_01A819
	LDA.w #$0200
	BRA.b CODE_01A819

CODE_01A812:
	LDA.w $721F,y
	EOR.w #$FFFF
	INC
CODE_01A819:
	STA.w $721F,y
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	RTS

;---------------------------------------------------------------------------

DATA_01A820:
	dw $FFC0,$0040

DATA_01A824:
	db $00,$01,$02,$03,$02,$01

DATA_01A82A:
	db $08,$06,$06,$08,$06,$06

CODE_01A830:
	TYX
	LDA.w $7A96,x
	BNE.b CODE_01A862
	LDY.w $7400,x
	LDA.w DATA_01A820,y
	STA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	LDA.w $7A98,x
	BNE.b CODE_01A862
	INC.b $16,x
	LDY.b $16,x
	CPY.b #$06
	BMI.b CODE_01A850
	STZ.b $16,x
	LDY.b #$00
CODE_01A850:
	LDA.w DATA_01A824,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_01A82A,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_01A862:
	RTS

;---------------------------------------------------------------------------

DATA_01A863:
	db $01,$02,$03,$02,$01,$00,$01,$02
	db $03,$02,$01,$02,$03,$02,$01,$02
	db $03,$02,$01

DATA_01A876:
	db $03,$03,$03,$03,$03,$03,$03,$03
	db $04,$04,$04,$04,$04,$06,$06,$06
	db $10,$06,$06

CODE_01A889:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_01A8B7
	INC.b $16,x
	LDY.b $16,x
	CPY.b #$14
	BMI.b CODE_01A8A5
CODE_01A897:
	STZ.w $7402,x
	STZ.b $16,x
	LDA.w #$0008
	STA.w $7A98,x
	STZ.b $76,x
	RTS

CODE_01A8A5:
	LDA.w DATA_01A863-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_01A876-$01,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_01A8B7:
	RTS

;---------------------------------------------------------------------------

DATA_01A8B8:
	db $02,$03,$02,$01

DATA_01A8BC:
	db $02,$10,$06,$06

CODE_01A8C0:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_01A8E0
	INC.b $16,x
	LDY.b $16,x
	CPY.b #$05
	BPL.b CODE_01A897
	LDA.w DATA_01A8B8-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_01A8BC-$01,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_01A8E0:
	RTS

;---------------------------------------------------------------------------

DATA_01A8E1:
	db $0C,$0B,$08,$09,$0A,$09,$08

DATA_01A8E8:
	db $04,$02,$04,$04,$04,$04,$60

DATA_01A8EF:
	db $08,$0A,$0C

CODE_01A8F2:
	TYX
	LDA.w $7A98,x
	BEQ.b CODE_01A8FB
	JMP.w CODE_01A9F2

CODE_01A8FB:
	INC.b $16,x
	LDY.b $16,x
	CPY.b #$03
	BEQ.b CODE_01A906
	JMP.w CODE_01A9C8

CODE_01A906:
	LDA.w #!Define_YI_AmbSpr1F4
	JSL.l CODE_spawn_ambient_sprite
	LDA.w #$0008
	STA.w $73C2,y
	CLC
	ADC.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	CLC
	ADC.w #$0004
	STA.w $7142,y
	LDA.w #$0002
	STA.w $7782,y
	LDA.b $10
	STA.b $06
	XBA
	STA.b $08
	LDA.w $70E2,x
	STA.b $0A
	LDA.w $7182,x
	STA.b $0C
	LDY.b #$03
CODE_01A93D:
	PHY
	LDA.w #$0112
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_01A9C3
	LDA.b $06
	AND.w #$003F
	SEC
	SBC.w #$001C
	STA.b $04
	CLC
	ADC.b $0A
	STA.w $70E2,y
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b $08
	AND.w #$001F
	EOR.w #$FFFF
	SEC
	SBC.w #$0003
	STA.b $02
	CLC
	ADC.b $0C
	STA.w $7182,y
	CLC
	ADC.w #$0008
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	PHY
	LDX.b #FXCODE_0ACE2F>>16
	LDA.w #FXCODE_0ACE2F
	JSL.l !RAM_YI_Global_RT_00DE91
	LDX.b $12
	PLY
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$0000
	BNE.b CODE_01A998
	TYX
	JSL.l CODE_03A31E
	LDX.b $12
	BRA.b CODE_01A9A5

CODE_01A998:
	LDA.b $06
	XBA
	AND.w #$001F
	CLC
	ADC.w #$0050
	STA.w $7A96,y
CODE_01A9A5:
	LDA.b $06
	EOR.w #$FFFF
	ROR
	ROR
	ROR
	ROR
	INC
	STA.b $06
	LDA.b $08
	ROR
	ROR
	ROR
	EOR.w #$FFFF
	DEC
	STA.b $08
	PLY
	DEY
	BEQ.b CODE_01A9C4
	JMP.w CODE_01A93D

CODE_01A9C3:
	PLY
CODE_01A9C4:
	LDY.b $16,x
	BRA.b CODE_01A9E0

CODE_01A9C8:
	CPY.b #$08
	BMI.b CODE_01A9E0
	LDA.w #$0009
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
	INC
	STA.b $78,x
	STZ.b $16,x
	INC.b $76,x
	RTS

CODE_01A9E0:
	LDA.w DATA_01A8E1-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w DATA_01A8E8-$01,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_01A9F2:
	LDA.w $7A36,x
	BEQ.b CODE_01AA1A
	LDY.b $16,x
	CPY.b #$03
	BPL.b CODE_01AA1A
	LDA.w DATA_01A8EF,y
	AND.w #$00FF
	SEC
	SBC.w #$0020
	CLC
	ADC.w $7182,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60A8
	STZ.w $60B4
	STZ.w $60AA
	INC.w $61B4
CODE_01AA1A:
	RTS

;---------------------------------------------------------------------------

DATA_01AA1B:
	db $09,$0A,$09,$08

CODE_01AA1F:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_01AA5C
	INC.b $16,x
	LDY.b $16,x
	CPY.b #$04
	BMI.b CODE_01AA4D
	LDA.w #!Define_YI_SoundID03_Swim
	JSL.l CODE_push_sound_queue
	STZ.b $16,x
	LDY.b #$00
	DEC.b $78,x
	BNE.b CODE_01AA4D
	LDA.w #$000B
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A98,x
	STA.b $16,x
	INC.b $76,x
	RTS

CODE_01AA4D:
	LDA.w DATA_01AA1B,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0004
	STA.w $7A98,x
CODE_01AA5C:
	RTS

;---------------------------------------------------------------------------

DATA_01AA5D:
	db $0C,$00,$0D,$0E,$0F,$10,$0F,$0E
	db $0D,$00,$02,$03,$02,$01

CODE_01AA6B:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_01AA9C
	INC.b $16,x
	LDY.b $16,x
	CPY.b #$0F
	BMI.b CODE_01AA8D
	STZ.w $7402,x
	STZ.b $16,x
	LDA.w #$0040
	STA.w $7A96,x
	LDA.w #$0043
	STA.w $7A98,x
	STZ.b $76,x
	RTS

CODE_01AA8D:
	LDA.w DATA_01AA5D-$01,y
	AND.w #$00FF
	STA.w $7402,x
	LDA.w #$0003
	STA.w $7A98,x
CODE_01AA9C:
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; GEORGETTE JELLY GOO (sprite $112) -- droplets spat off by sprite $111.
;=========================================================================

;-------------------------------------------------------------------------
; Georgette Jelly Goo Init. Trivial (no per-spawn setup).
; INPUTS:  X = sprite slot. OUTPUTS: (none).
;-------------------------------------------------------------------------
YI_NorSpr112_GeorgetteJellyGoo_Init:
init_jelly_goo:
;$01AA9D
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Georgette Jelly Goo Main. Tiny droplet that splatted off the parent.
; State byte in $76,x:
;   $00 -> INC $76 and return (one-frame settle)
;   $01 -> "settled" -- arm $7542 drag, $7A98 anim timer; when $7402
;          (anim frame) < 2, INC frame. On $7860&1 (ground hit), JML to
;          CODE_03A31E to despawn.
; INPUTS:   X = slot. OUTPUTS: per-frame anim; despawn on land.
; CALLERS:  Bank03 sprite-list traversal.
;-------------------------------------------------------------------------
YI_NorSpr112_GeorgetteJellyGoo_Main:
main_splashed_flan:                     ; Raidenthequick: main_splashed_flan
;$01AA9E
	JSL.l CODE_03AF23
	LDY.b $76,x
	BNE.b CODE_01AAA9
	INC.b $76,x
CODE_01AAA8:
	RTL

CODE_01AAA9:
	LDA.w $7A96,x
	BNE.b CODE_01AAD5
	LDY.b $18,x
	BNE.b CODE_01AAC0
	LDA.w #$0020
	STA.w $7542,x
	LDA.w #$0008
	STA.w $7A98,x
	INC.b $18,x
CODE_01AAC0:
	LDA.w $7A98,x
	BNE.b CODE_01AAD5
	LDA.w #$0008
	STA.w $7A98,x
	LDY.w $7402,x
	CPY.b #$02
	BPL.b CODE_01AAD5
	INC.w $7402,x
CODE_01AAD5:
	LDA.w #$0006
	STA.w $74A2,x
	LDA.w $7860,x
	AND.w #$0001
	BEQ.b CODE_01AAA8
	JML.l CODE_03A31E

;---------------------------------------------------------------------------

;=========================================================================
; HARRY HEDGEHOG (sprite $085) -- spiky rolling hedgehog enemy.
;=========================================================================

;-------------------------------------------------------------------------
; Harry Hedgehog Init. Trivial. INPUTS: X = slot. OUTPUTS: (none).
;-------------------------------------------------------------------------
YI_NorSpr085_HarryHedgehog_Init:
init_hedgehog:                          ; Raidenthequick: init_hedgehog
;$01AAE7
	RTL

;---------------------------------------------------------------------------

DATA_01AAE8:
	dw CODE_01AB6A
	dw CODE_01AC06

;-------------------------------------------------------------------------
; Harry Hedgehog Main. 2-state machine via DATA_01AAE8:
;   $00 = walking (CODE_01AB6A)
;   $01 = rolling/curled (CODE_01AC06)
; Calls CODE_03AA52 (egg-on-spikes special) if $7040,x bit 0 set, then
; CODE_03AF23 (housekeeping), state dispatch, CODE_01AB13 (per-frame
; SuperFX OAM build), and CODE_03A858 (hit-flash) when stomped.
; INPUTS:   X = slot; $76,x = state.
; CALLERS:  Bank03 sprite-list traversal.
;-------------------------------------------------------------------------
YI_NorSpr085_HarryHedgehog_Main:
main_hedgehog:                          ; Raidenthequick: main_hedgehog
;$01AAEC
	LDA.w $7040,x
	LSR
	BCC.b CODE_01AAF6
	JSL.l CODE_03AA52
CODE_01AAF6:
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_01AAE8,x)
	JSR.w CODE_01AB13
	LDY.w $7D36,x
	BPL.b CODE_01AB0E
	JSL.l CODE_03A858
CODE_01AB0E:
	RTL

;---------------------------------------------------------------------------

DATA_01AB0F:
	dw FXDATA_548000+$6000,FXDATA_548000+$6020

CODE_01AB13:
	LDA.w $7040,x
	LSR
	BCC.b CODE_01AB61
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #$0C00
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $7A36,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDY.b $18,x
	LDA.w DATA_01AB0F,y
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDA.w #(FXDATA_548000+$6000)>>16
	STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
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
	LDX.b #FXCODE_08D964>>16
	LDA.w #FXCODE_08D964
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $12
	INC.w $0CF9
CODE_01AB61:
	RTS

;---------------------------------------------------------------------------

DATA_01AB62:
	dw $FE80,$0180,$0010,$FFF8

CODE_01AB6A:
	TYX
	LDY.w $7400,x
	LDA.w DATA_01AB62,y
	STA.w $75E0,x
	LDA.w #$0020
	STA.w $7540,x
	LDY.w $7AF8,x
	BNE.b CODE_01ABC1
	LDA.w $7C16,x
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_01ABC1
	LDA.w $7C18,x
	CLC
	ADC.w #$0040
	CMP.w #$0080
	BCS.b CODE_01ABC1
	JSL.l CODE_03AD74
	BCC.b CODE_01ABC1
	LDA.w #$7C60
	STA.w $6FA0,x
	LDA.w #$2175
	STA.w $7040,x
	STZ.w $7402,x
	LDA.w #$0080
	STA.w $7A36,x
	STZ.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STZ.w $7540,x
	LDA.w #$0040
	STA.w $7A96,x
	INC.b $76,x
	RTS

CODE_01ABC1:
	LDY.w $7A98,x
	BNE.b CODE_01ABD5
	LDA.w #$0004
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0001
	STA.w $7402,x
CODE_01ABD5:
	LDY.w $7AF6,x
	BNE.b CODE_01AC05
	LDA.w #$0004
	STA.w $7AF6,x
	LDA.w #!Define_YI_AmbSpr1D8
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $7400,x
	STA.w $73C0,y
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w #$0002
	STA.w $7782,y
	INC
	STA.w $7E4C,y
	ASL
	CLC
	ADC.w $7182,x
	STA.w $7142,y
CODE_01AC05:
	RTS

;---------------------------------------------------------------------------

CODE_01AC06:
	TYX
	LDY.w $77C2,x
	TYA
	STA.w $7400,x
	LDY.w $7D36,x
	DEY
	BMI.b CODE_01AC29
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_01AC29
	LDA.w $7D38,y
	BEQ.b CODE_01AC29
	TYX
	JSL.l CODE_kill_sprite_by_hit_special_cases
	STZ.w $7A96,x
CODE_01AC29:
	LDY.w $7A96,x
	BEQ.b CODE_01AC3F
	LDA.w $7A36,x
	CLC
	ADC.w #$0010
	CMP.w #$0100
	BMI.b CODE_01AC66
	LDA.w #$0100
	BRA.b CODE_01AC66

CODE_01AC3F:
	LDA.w $7A36,x
	SEC
	SBC.w #$0010
	CMP.w #$0080
	BPL.b CODE_01AC66
	LDA.w #$0040
	STA.w $7AF8,x
	STZ.b $76,x
	LDA.w #$7E00
	STA.w $6FA0,x
	LDA.w #$0974
	STA.w $7040,x
	JSL.l CODE_03AEFD
	LDA.w #$0080
CODE_01AC66:
	STA.w $7A36,x
	LDY.w $7A98,x
	BNE.b CODE_01AC79
	LDA.w #$0004
	STA.w $7A98,x
	LSR
	EOR.b $18,x
	STA.b $18,x
CODE_01AC79:
	RTS

;---------------------------------------------------------------------------

DATA_01AC7A:
	dw $FE00,$0200,$FD00,$0300

DATA_01AC82:
	dw $0004,$0006,$0008,$000C

DATA_01AC8A:
	dw $FFD0,$0120

;=========================================================================
; GUSTY (sprite $0E6) -- floating wind enemy.
;=========================================================================

;-------------------------------------------------------------------------
; Gusty Init. Two paths based on Y bit 4:
;   Y & $0010 == 0: GENERATOR -- snaps spawn position to nearest 32px,
;     sets row from $70E2,x & $0010 + DATA_01AC8A[Y>>3] = $FFD0/$0120
;     into $701900,x, sets $74A2 = $FF (invincible), OAM = $0060 / $4000
;     / $0002. INC $76. Increments the global Gusty-generator-active
;     flag.
;   Y & $0010 != 0: NORMAL FLOATING enemy. Calls common setup
;     CODE_01ACF9 with direction selected by player position and frame.
; INPUTS:   X = slot; $70E2,x = X; $7182,x = Y.
; CALLERS:  Sprite Init dispatcher for sprite $0E6.
;-------------------------------------------------------------------------
YI_NorSpr0E6_Gusty_Init:
init_gusty:                             ; Raidenthequick: init_gusty
;$01AC8E
	LDA.w $7182,x
	BIT.w #$0010
	BEQ.b CODE_01ACCF
	AND.w #$FFE0
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	TAY
	LDA.w DATA_01AC8A,y
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.w #$00FF
	STA.w $74A2,x
	LDA.w #$0060
	STA.w $6FA0,x
	LDA.w #$4000
	STA.w $6FA2,x
	LDA.w #$0002
	STA.w $7040,x
	INC.b $76,x
	LDY.w !RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagLo
	BNE.b CODE_01ACCE
	INC.w !RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagLo
CODE_01ACCE:
	RTL

CODE_01ACCF:
	LDA.w $70E2,x
	PHA
	SEC
	SBC.w $6094
	STA.b $00
	PLA
	AND.w #$0010
	DEC
	EOR.b $00
	BMI.b CODE_01ACE6
	JML.l CODE_03A31E

CODE_01ACE6:
	LDA.b $10
	AND.w #$0004
	STA.b $00
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	STA.w $7400,x
CODE_01ACF9:
	ORA.b $00
	TAY
	LDA.w DATA_01AC7A,y
	STA.w $75E0,x
	LDA.b $00
	LSR
	STA.b $78,x
	TAY
	LDA.w DATA_01AC82,y
	STA.w $7540,x
	RTL

;---------------------------------------------------------------------------

DATA_01AD0F:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $FE00,$0200

DATA_01AD13:
	dw $FE00,$0200

;-------------------------------------------------------------------------
; Gusty Main. Two-mode: floating-enemy ($76 = 0) and generator
; ($76 != 0).
; Floating-enemy: damage check, wing-flap anim, position-based sprite-
; frame selection from DATA_01AC82, drift-jiggle on $7860 contact.
; Generator: spawns a new Gusty every $0100 frames at $7682+$0040 Y;
; clears global flag if all Gusty spawned. INPUTS: X = slot.
; CALLERS:  Bank03 sprite-list traversal.
;-------------------------------------------------------------------------
YI_NorSpr0E6_Gusty_Main:
main_gusty:                             ; Raidenthequick: main_gusty
;$01AD17
	LDY.w $7D38,x
	BEQ.b CODE_01AD30
	LDA.b $10
	AND.w #$0004
	STA.b $00
	LDA.w $7400,x
	JSL.l CODE_01ACF9
	STZ.w $7D38,x
	STZ.w $75E2,x
CODE_01AD30:
	JSL.l CODE_03AF23
	LDY.b $76,x
	BEQ.b CODE_01AD3B
	JMP.w CODE_01ADC2

CODE_01AD3B:
	LDA.w $7A96,x
	BNE.b CODE_01AD92
	LDY.w $7D36,x
	BPL.b CODE_01AD92
	LDA.w $7C18,x
	SEC
	SBC.w $6122
	SEC
	SBC.w $7BB8,x
	CMP.w #$FFF6
	BCC.b CODE_01AD64
	LDY.w $60AB
	BMI.b CODE_01AD92
	LDY.w $60C0
	BEQ.b CODE_01AD64
	JSL.l CODE_03A5B7
	RTL

CODE_01AD64:
	JSL.l CODE_03A858
	LDA.w $61B2
	BPL.b CODE_01AD92
	AND.w #$0FFF
	STA.w $61B2
	LDA.w #$0040
	STA.w $7A96,x
	ASL
	ASL
	STA.w $614A
	LDY.w $7400,x
	LDA.w DATA_01AD13,y
	CLC
	ADC.w $60A8
	STA.w $60A8
	STA.w $60B4
	JSL.l CODE_06BEC1
CODE_01AD92:
	LDA.w $7A98,x
	BNE.b CODE_01ADA7
	LDA.w #$0006
	STA.w $7A98,x
	LDA.w $7402,x
	INC
	AND.w #$0003
	STA.w $7402,x
CODE_01ADA7:
	LDY.b $78,x
	LDA.w $7680,x
	SEC
	SBC.w #$0040
	CMP.w #$0080
	BCS.b CODE_01ADBB
	TYA
	CLC
	ADC.w #$0004
	TAY
CODE_01ADBB:
	LDA.w DATA_01AC82,y
	STA.w $7540,x
	RTL

CODE_01ADC2:
	LDY.w !RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagLo
	BEQ.b CODE_01ADD6
	LDA.w $7682,x
	CLC
	ADC.w #$0040
	CMP.w #$0180
	BCC.b CODE_01ADDA
	STZ.w !RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagLo
CODE_01ADD6:
	JML.l CODE_03A31E

CODE_01ADDA:
	LDY.b $18,x
	BEQ.b CODE_01ADEE
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,y
	CMP.w #$0010
	BNE.b CODE_01ADF3
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	CMP.w #!Define_YI_NorSpr0E6_Gusty
	BNE.b CODE_01ADF3
CODE_01ADEE:
	LDA.w $7A96,x
	BNE.b CODE_01AE17
CODE_01ADF3:
	LDA.w #$00E6
	JSL.l CODE_spawn_sprite_init
	BCC.b CODE_01AE17
	LDA.w $6094
	AND.w #$FFEF
	CLC
	ADC.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	STA.w $70E2,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	STA.w $7182,y
	STY.b $18,x
	LDA.w #$0100
	STA.w $7A96,x
CODE_01AE17:
	RTL

;---------------------------------------------------------------------------

;=========================================================================
; WATERMELON SEED (sprite $107) -- spat by player after eating melon.
;=========================================================================

;-------------------------------------------------------------------------
; Watermelon Seed Init. Trivial. INPUTS: X = slot. OUTPUTS: (none).
; The seed is spawned by the player when Yoshi spits a seed of any
; watermelon variety; ammo type / palette is set by spawn caller.
;-------------------------------------------------------------------------
YI_NorSpr107_WatermelonSeed_Init:
init_watermelon_seed:                   ; Raidenthequick: init_watermelon_seed
;$01AE18
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; Watermelon Seed Main.
; - If $7860,x != 0 (ground/enemy hit) -> spawn AmbSpr $229 (smoke
;   puff), copy position + invert X-velocity, set Y-velocity = $FD80,
;   despawn (JML CODE_03A31E).
; - Else if $7A38,x != 0 (death-trigger flag) and $7D36 < 0 (off-
;   screen) -> hit-flash + kill, set $03BC = 1 (seed-respawn flag).
; - Else just run shared housekeeping. INPUTS: X = slot.
; CALLERS:  Bank03 sprite-list traversal.
;-------------------------------------------------------------------------
YI_NorSpr107_WatermelonSeed_Main:
main_seed:                              ; Raidenthequick: main_seed
;$01AE19
	LDY.w $7860,x
	BEQ.b CODE_01AE54
CODE_01AE1E:
	LDA.w #!Define_YI_AmbSpr229
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70E2,x
	STA.w $70A2,y
	LDA.w $7182,x
	STA.w $7142,y
	LDA.w !EXRAM_YI_Level_NorSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	BEQ.b CODE_01AE47
	CMP.w #$8000
	ROR
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
CODE_01AE44:
	LDA.w #$FD80
CODE_01AE47:
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	LDA.w #$FFFF
	STA.w $7782,y
	JML.l CODE_03A31E

CODE_01AE54:
	LDA.w $7A38,x
	BEQ.b CODE_01AE71
	LDY.w $7D36,x
	BPL.b CODE_01AE71
	LDA.w $61D6
	BNE.b CODE_01AE71
	JSL.l CODE_03A858
	JSL.l CODE_kill_sprite_by_hit_special_cases
	LDA.w #$0001
	STA.w $03BC
CODE_01AE71:
	JSL.l CODE_03AF23
	RTL

;---------------------------------------------------------------------------

;=========================================================================
; BOO GUY ON PULLEY (sprite $10D) -- Boo Guy operating a pulley platform.
; State machine with 6 entries via DATA_01AE89 (one entry = CODE_unused_8000_stub
; stub at top of bank).
;=========================================================================

;-------------------------------------------------------------------------
; Boo Guy on Pulley Init.
; Sets $7400 (facing) from bit 4 of X ($70E2 & $0010 -- the X-cell parity;
; no position snap happens here, despite the parity read), OAM $7040 =
; $1885 (pulley sprite palette/tile).
; INPUTS:   X = slot; $70E2,x = X-position.
; CALLERS:  Sprite Init dispatcher for sprite $10D.
;-------------------------------------------------------------------------
YI_NorSpr10D_BooGuyOperatingPulley_Init:
init_pulley_guy:                        ; Raidenthequick: init_pulley_guy
;$01AE76
	LDA.w $70E2,x
	AND.w #$0010
	LSR
	LSR
	LSR
	STA.w $7400,x
	LDA.w #$1885
	STA.w $7040,x
	RTL

;---------------------------------------------------------------------------

DATA_01AE89:
	dw CODE_01AEB9
	dw CODE_01AEDA
	dw CODE_01AEFD
	dw CODE_unused_8000_stub
	dw CODE_01AF10
	dw CODE_01AF49

;-------------------------------------------------------------------------
; Boo Guy on Pulley Main. 6-state machine via DATA_01AE89 (one entry is
; the CODE_unused_8000_stub at $01:8000).
;   $00 CODE_01AEB9 -- idle pulley anim cycle 0..B
;   $01 CODE_01AEDA -- pulley-tug increasing (frames 0..13, then $7402=$10,
;                       INC $76)
;   $02 CODE_01AEFD -- pulley spinning (frames $10..$13 cycle)
;   $03 CODE_unused_8000_stub (no-op)
;   $04 CODE_01AF10 -- pulley pause (4-tick cycles cycling $7402 EOR $07)
;   $05 CODE_01AF49 -- pulley winding back ($7402 from DATA_01AF3F:
;                       $04/$05/$06/$07/$08*7 -> back to $00)
; Plays pulley-squeak sound every 4 frames during states 1..4.
; INPUTS:  X = slot; $76,x state; $7A98 timer; $7402 anim frame.
; CALLERS: Bank03 sprite-list traversal.
;-------------------------------------------------------------------------
YI_NorSpr10D_BooGuyOperatingPulley_Main:
main_pulley_guy:                        ; Raidenthequick: main_pulley_guy
;$01AE95
	JSL.l CODE_03AF23
	TXY
	LDA.b $76,x
	ASL
	TAX
	JSR.w (DATA_01AE89,x)
	LDY.b $76,x
	BEQ.b CODE_01AEA9
	CPY.b #$05
	BMI.b CODE_01AEB8
CODE_01AEA9:
	LDA.w $7974
	AND.w #$0003
	BNE.b CODE_01AEB8
	LDA.w #!Define_YI_SoundID5A_PulleySqueak
	JSL.l CODE_push_sound_queue
CODE_01AEB8:
	RTL

CODE_01AEB9:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_01AED2
	LDA.w #$0004
	STA.w $7A98,x
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$0C
	BNE.b CODE_01AED2
	STZ.w $7402,x
CODE_01AED2:
	RTS

DATA_01AED3:
	db $04,$03,$02,$01,$01,$01,$01

CODE_01AEDA:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_01AEFC
	INC.w $7402,x
	LDY.w $7402,x
	CPY.b #$14
	BNE.b CODE_01AEF3
	LDA.w #$0010
	STA.w $7402,x
	INC.b $76,x
	RTS

CODE_01AEF3:
	LDA.w DATA_01AED3-$0D,y
	AND.w #$00FF
	STA.w $7A98,x
CODE_01AEFC:
	RTS

CODE_01AEFD:
	TYX
	LDA.w $7402,x
	INC
	AND.w #$0003
	ORA.w #$0010
	STA.w $7402,x
	RTS

DATA_01AF0C:
	db $20,$04,$04,$04

CODE_01AF10:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_01AF3E
	DEC.b $16,x
	BNE.b CODE_01AF2A
	LDA.w #$0008
	STA.w $7A98,x
	LDY.b #$0B
	STY.b $16,x
	STZ.w $7402,x
	INC.b $76,x
	RTS

CODE_01AF2A:
	LDY.b $16,x
	LDA.w DATA_01AF0C-$01,y
	AND.w #$00FF
	STA.w $7A98,x
	LDA.w $7402,x
	EOR.w #$0007
	STA.w $7402,x
CODE_01AF3E:
	RTS

DATA_01AF3F:
	db $04,$05,$06,$07,$08,$08,$08,$08
	db $08,$08

CODE_01AF49:
	TYX
	LDA.w $7A98,x
	BNE.b CODE_01AF6D
	DEC.b $16,x
	BNE.b CODE_01AF5F
	LDA.w #$0004
	STA.w $7A98,x
	STZ.w $7402,x
	STZ.b $76,x
	RTS

CODE_01AF5F:
	LDY.b $16,x
	LDA.w DATA_01AF3F-$01,y
	AND.w #$00FF
	STA.w $7A98,x
	INC.w $7402,x
CODE_01AF6D:
	RTS

;---------------------------------------------------------------------------

;=========================================================================
; LEVEL-MODE / GAMEMODE machinery.
; This section sets up "in-level" state (gamemode $0C-$10) and runs
; the per-frame in-level dispatcher (gamemode $0F).
; See also: ys_game.asm (upstream level-mode + gamemode handlers).
;
; gamemode layout (per Raidenthequick / docs/enginecore.md S3.2):
;   $0C = level fade-in + name display
;   $0D = level fade-in post-pipe / post-door
;   $0E = (handled elsewhere -- transition glue)
;   $0F = the main per-frame in-level dispatcher (runs every frame
;         while gameplay is active; sub-dispatches via DATA_levelmode_index)
;   $10 = victory cutscene
;=========================================================================

;-------------------------------------------------------------------------
; CODE_prepare_in_level_states: called by the level fade-in gamemodes to
; zero per-level state. Calls $00:831C (clear sprite tables), then
; primes $61BC = $4000 (mosaic/screen init) and clears the Super Baby
; Mario timer.
;-------------------------------------------------------------------------
;-------------------------------------------------------------------------
; CODE_prepare_in_level_states.
; Common per-level-fade-in entry. Called by gm0c and gm0d.
;
; INPUTS:   (none direct -- relies on call context)
; OUTPUTS:  All sprite tables cleared (via CODE_clear_basic_states ($00:831C))
;           $61BC = $4000 (mosaic-screen-init word)
;           !EXRAM_YI_Player_SuperBabyMarioTimerLo = 0
; MODIFIES: A (M=$20 set), processor flags
; CALLERS:  CODE_gm0c_level_fadein_and_name, CODE_gm0d_level_fadein_post_pipe_or_door,
;           and the gamemode $31/$3B initial fade.
;-------------------------------------------------------------------------
CODE_01AF6E:
CODE_prepare_in_level_states:                ; Raidenthequick: CODE_prepare_in_level_states
	JSL.l CODE_clear_basic_states
	REP.b #$20
	LDA.w #$4000
	STA.w $61BC
	STZ.w !EXRAM_YI_Player_SuperBabyMarioTimerLo|!EXRAMBankMirror
	SEP.b #$20
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; DATA_levelmode_index: byte table mapping levelmode 00..0F -> dispatcher offset
; into the gamemode-0F sub-dispatcher table. Each entry is the offset
; (in bytes) into that table; offsets are 2 apart because the table
; holds word pointers.
;-------------------------------------------------------------------------
DATA_01AF80:
DATA_levelmode_index:                        ; Raidenthequick: DATA_levelmode_index
	db $04,$06,$08,$0A,$0C,$0E,$10,$12  ; levelmode 00..07
	db $14,$16,$18,$1A,$1C,$1E,$20,$22  ; levelmode 08..0F

;-------------------------------------------------------------------------
; CODE_gm0c_level_fadein_and_name.
; GAMEMODE $0C entry: level fade-in + "World N - Level N" name display.
;
; Pipeline per frame:
;   1. JSL CODE_init_oam_and_bg3_tilemap      ($00:8277) -- early hwregs init.
;   2. JSL CODE_prepare_in_level_states      -- CODE_prepare_in_level_states.
;   3. JSL CODE_clear_all_sprites      -- palette / fade init.
;   4. Check $038C (re-entry flag): nonzero -> JMP CODE_level_reentry_dispatch (midring
;      restart entry, different setup path), else fall through:
;   5. JSL CODE_dma_init_gen_purpose      -- DMA-clear $200 bytes of OAM at $0392.
;   6. Clear $03C0..$0580 (sprite/object scratch tables, 8 rows of 64).
;   7. Set !RAM_YI_Level_StarTimerLo = !Define_YI_Level_PlayFinishRegen-
;      StarTimerSoundThreshold (the level's initial star count).
;   8. Resolve the entrance record: $021A holds the world-map tile-slot
;      (translevel), DATA_17F3E7[translevel x2] gives a byte offset into
;      DATA_17F471. Read entrance X/Y from record bytes +1/+2 (each << 4 ->
;      Player.X/Y), load the level-data ID from byte +0, then JMP CODE_load_level_data_pointers
;      (byte +0 x6 indexes Ptrs: for the object/sprite pointers).
;
; INPUTS:    !RAM_YI_Level_CurrentLevelFromMapLo = level to load
;            $038C = re-entry flag
; OUTPUTS:   Player position seeded; level pointers loaded; gamemode
;            advances to $0F (in-level run loop) at end of init chain.
; CALLERS:   Master gamemode dispatcher (Bank00 or Bank03 via
;            $0083E2 / 1083E2 path).
;-------------------------------------------------------------------------
CODE_01AF90:
CODE_gm0c_level_fadein_and_name:
	JSL.l CODE_init_oam_and_bg3_tilemap
	JSL.l CODE_prepare_in_level_states
	JSL.l CODE_clear_all_sprites
	LDA.w $038C
	BEQ.b CODE_01AFA4
	JMP.w CODE_level_reentry_dispatch

CODE_01AFA4:
	REP.b #$20
	LDY.b #$00
	STZ.b $21
	LDA.w #$0392
	STA.b $20
	LDA.w #$022E
	JSL.l CODE_dma_init_gen_purpose
	SEP.b #$20
	REP.b #$30
	STZ.w !EXRAM_YI_Level_ShowHiddenItemsFlag|!EXRAMBankMirror
	LDX.w #$003E
CODE_01AFC0:
	STZ.w $03C0,x
	STZ.w $0400,x
	STZ.w $0440,x
	STZ.w $0480,x
	STZ.w $04C0,x
	STZ.w $0500,x
	STZ.w $0540,x
	STZ.w $0580,x
	DEX
	DEX
	BPL.b CODE_01AFC0
	LDA.w #!Define_YI_Level_PlayFinishRegenStarTimerSoundThreshold
	STA.w !RAM_YI_Level_StarTimerLo
	STZ.w $03A5
	STZ.w $03A3
	LDA.w #$0001
	STA.w $03A1
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo	; world-map tile-slot (translevel)
	ASL
	TAX
	LDA.l YI_LevelDataPtrsAndEntranceData_DATA_17F3E7,x	; -> byte offset into entrance records
	TAX
	LDA.l YI_LevelDataPtrsAndEntranceData_DATA_17F471+$01,x	; record byte +1 = entrance X
	AND.w #$00FF
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.l YI_LevelDataPtrsAndEntranceData_DATA_17F471+$02,x	; record byte +2 = entrance Y
	AND.w #$00FF
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.l YI_LevelDataPtrsAndEntranceData_DATA_17F471,x	; record byte +0 = level-data ID (Ptrs key)
	JMP.w CODE_load_level_data_pointers

;-------------------------------------------------------------------------
; Re-entry path (reached from gm0C entry when $038C != 0). Unlike the
; fresh-from-map path (CODE_01AFA4), the entrance data here comes from the
; live screen-exit table !RAM_YI_Level_ScreenExitTable ($7F:7E00), which
; the object-stream parser populated for the current level (4 bytes per
; screen region: level-data ID, dest X, dest Y, entrance state). $038E
; (!RAM_YI_Level_CurrentScreenExitLo) selects which exit fired.
;   $038C == 1 : a screen-exit warp (pipe/door/water) fired -> CODE_apply_screen_exit_destination.
;   $038C >= 2 : entrance already staged (e.g. gm35 midring restart) ->
;                skip straight to CODE_01B0AD (header load).
;-------------------------------------------------------------------------
CODE_01B01B:
CODE_level_reentry_dispatch:
	REP.b #$30
	STZ.w $0396
	LDA.w $038C
	DEC
	BEQ.b CODE_apply_screen_exit_destination
	JMP.w CODE_01B0AD

;-------------------------------------------------------------------------
; Read the fired exit's destination. Destination IDs $DE+ are not levels --
; they are bandit-minigame triggers, routed to gm$2E with the minigame index
; (dest - $DE)*2. Normal level destinations (< $DE) fall through to set the
; player entrance from the exit record.
;-------------------------------------------------------------------------
CODE_01B029:
CODE_apply_screen_exit_destination:
	LDX.w $038E					; current screen-exit index ($038E)
	LDA.l $7F7E00,x					; exit byte +0 = destination level-data ID
	AND.w #$00FF
	CMP.w #$00DE					; >= $DE -> bandit-minigame trigger, not a level
	BCC.b CODE_set_player_entrance_from_exit
	SBC.w #$00DE
	ASL
	STA.w $03A7					; minigame index = (dest - $DE) * 2
	LDA.l $7F7E03,x					; exit byte +3 = entrance state
	AND.w #$00FF
	STA.w $0374
	LDA.l $7F7E01,x					; exit byte +1 = dest X
	STA.w $0375
	LDA.w !RAM_YI_Level_StarTimerLo
	STA.w $0377
	JML.l CODE_gm2e_main_bandit_minigame

;-------------------------------------------------------------------------
; Normal-level re-entry: seed Player.X/Y and state from the exit record,
; then fall through to CODE_load_level_data_pointers to load the level-data pointers.
;-------------------------------------------------------------------------
CODE_01B05A:
CODE_set_player_entrance_from_exit:
	LDA.l $7F7E01,x					; exit byte +1 = dest X
	AND.w #$00FF
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	LDA.l $7F7E02,x					; exit byte +2 = dest Y
	AND.w #$00FF
	ASL
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	LDA.l $7F7E03,x					; exit byte +3 = entrance/Yoshi state
	AND.w #$00FF
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	LDA.l $7F7E00,x					; exit byte +0 = destination level-data ID
CODE_01B084:
CODE_load_level_data_pointers:
; Shared tail: A = level-data ID (entrance-record byte +0 from CODE_01AFA4, or the
; screen-exit destination byte $7F7E00). X = level-data ID x6; Ptrs:[X] holds this
; level's `dl object_ptr, sprite_ptr`.
	AND.w #$00FF
	ASL
	STA.b $00
	ASL
	ADC.b $00					; X = level-data ID x6
	TAX
	LDA.l YI_LevelDataPtrsAndEntranceData_Ptrs,x		; object data ptr (lo word)
	STA.b !RAM_YI_Level_LevelDataPtrLo
	LDA.l YI_LevelDataPtrsAndEntranceData_Ptrs+$01,x	; object data ptr (hi + low byte)
	STA.b !RAM_YI_Level_LevelDataPtrHi
	LDA.l YI_LevelDataPtrsAndEntranceData_Ptrs+$03,x	; sprite data ptr (lo word)
	STA.l !EXRAM_YI_Level_SpriteDataPtrLo
	LDA.l YI_LevelDataPtrsAndEntranceData_Ptrs+$05,x	; sprite data ptr (bank)
	AND.w #$00FF
	STA.l !EXRAM_YI_Level_SpriteDataPtrBank
CODE_01B0AD:
	STZ.w !RAM_YI_Level_DoBonusChallengeFlagLo
	SEP.b #$30
	JSL.l CODE_unpack_level_header
	REP.b #$20
	LDA.w #$07B0
	LDX.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	CPX.b #$13
	BEQ.b CODE_01B0C9
	CPX.b #$1D
	BNE.b CODE_01B0CC
	LDA.w #$0700
CODE_01B0C9:
	STA.w $61BC
CODE_01B0CC:
	SEP.b #$20
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.b #!Define_YI_LevelID_WelcomeToYoshisIsland
	BNE.b CODE_01B0DA
	LDA.b #$11
	STA.w !RAM_YI_Level_LevelHeaderMusicSettingLo
CODE_01B0DA:
	JSL.l CODE_upload_music_data
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.b #$09
	BNE.b CODE_01B0EA
	JSR.w CODE_load_levelmode_09_settings
	BRA.b CODE_01B118

CODE_01B0EA:
	CMP.b #$0A
	BNE.b CODE_01B0F8
	JSL.l CODE_00B4D3
	JSL.l CODE_00BB90
	BRA.b CODE_01B118

CODE_01B0F8:
	JSL.l CODE_load_level_gfx
	JSL.l CODE_init_tileset_animation
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.b #$03
	BNE.b CODE_01B10A
	JSR.w CODE_load_3d_sprite_graphic
CODE_01B10A:
	JSL.l CODE_load_level_palettes
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	LDX.w DATA_levelmode_index,y
	JSL.l CODE_init_scene_regs
CODE_01B118:
	JSL.l CODE_hdma_and_gradient_init
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.b #$09
	BEQ.b CODE_01B12D
	CMP.b #$0A
	BEQ.b CODE_01B12D
	JSR.w CODE_load_bg2_tilemap
	JSR.w CODE_load_bg3_tilemap
CODE_01B12D:
	JSL.l CODE_copy_division_lookup_to_sram
	LDA.w $038C
	BEQ.b CODE_01B139
	JMP.w CODE_01B1F3

CODE_01B139:
	LDA.b #$0F
	STA.w $0200
	LDA.b #$01
	STA.w $0201
	JSL.l CODE_108FD6
	LDX.b #$7F
CODE_01B149:
	STZ.w $6CAA,x
	DEX
	BPL.b CODE_01B149
	REP.b #$20
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0090
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0018
	STA.w $6094
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0094
	STA.w $609C
	INC.w $60C0
	JSL.l CODE_04DC28
	REP.b #$20
	LDA.w #$0006
	STA.w $60C0
	LDA.w #$0280
	STA.w $60B4
	LDA.w #$FC00
	STA.w $60AA
	LDA.w #!Define_YI_PlayerState16_LevelIntro
	STA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	SEP.b #$20
	JSL.l CODE_clear_lz2_staging_buffer
	LDA.b #$01
	STA.w $0B54
	REP.b #$20
	LDA.w #$0002
	STA.w $0121
	LDA.w #$0120
	STA.w $0B4C
	JSL.l CODE_108F49
	LDA.b #!Define_YI_MusicID03_CastleAndIntroTheme
	STA.b !RAM_YI_Global_PlayMusicLo
	LDA.b #$02
	STA.w $0125
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$D8
	STA.w !REGISTER_VCountTimerLo
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	JSL.l CODE_load_level_object_stream
	REP.b #$20
CODE_01B1C8:
	LDA.w $0D23
	CMP.w #$00C0
	BCC.b CODE_01B1C8
	LDA.w #$7FFF
	STA.l YI_Global_PaletteMirror[$82].LowByte
	SEP.b #$20
	STZ.w $0121
	REP.b #$20
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.w $60A6
	LDA.b !RAM_YI_Global_Layer1XPosLo
	SEC
	SBC.w #$0100
	STA.w $60A4
	SEP.b #$20
	INC.w !RAM_YI_Global_CurrentGameMode
	BRA.b CODE_01B22F

CODE_01B1F3:
	DEC
	BNE.b CODE_01B1FA
	JSL.l CODE_load_level_object_stream
CODE_01B1FA:
	JSL.l CODE_04DB68
	JSL.l CODE_check_newspr_screen
	LDA.w $7E1A
	CMP.b #$0F
	BEQ.b CODE_01B211
	JSL.l CODE_04DCC4
	JSL.l CODE_check_newspr_screen
CODE_01B211:
	JSL.l CODE_108FD6
	STZ.w $038C
	STZ.w $0121
	LDA.b #$02
	STA.w $0125
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$D8
	STA.w !REGISTER_VCountTimerLo
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
CODE_01B22F:
	REP.b #$30
	JSL.l CODE_04DCF9
	SEP.b #$30
	LDA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	AND.b #$07
	CMP.b #$02
	BNE.b CODE_01B243
	INC.w $61CA
CODE_01B243:
	JSL.l CODE_01B25E
	JML.l CODE_increment_gamemode

;---------------------------------------------------------------------------

;@editable:music-init-songs begin
DATA_01B24B:
	; SMWC tweak $01B259: byte at offset $0E (15th entry) -- change to [02] (and
	; pair with $00853D->[04]) to make music header E play "Welcome to Yoshi's
	; Island". Default below shows the [$00] at end of second row in source order.
	db $01,$01,$01,$01,$01,$09,$01,$01
	db $09,$0C,$01,$02,$00,$01,$00,$00
	db $00,$02,$01
;@editable:music-init-songs end

CODE_01B25E:
	PHP
	SEP.b #$30
	LDA.w $0205
	BNE.b CODE_01B273
	LDX.w $0203
	LDA.l DATA_01B24B-$01,x
	STA.w !RAM_YI_Global_PlayMusicLo
	STA.w $0205
CODE_01B273:
	STZ.w !RAM_YI_Global_PlaySoundHighPriorityLo
	STZ.w !RAM_YI_Global_SoundQueueSizeLo
	PLP
	RTL

;---------------------------------------------------------------------------

CODE_01B27B:
CODE_clear_lz2_staging_buffer:                 ; zero the 2KB LZ2 staging buffer at $70:5800 (called before re-decompressing graphics)
	LDA.b #$705800>>16
	STA.b $22
	REP.b #$20
	LDA.w #$705800
	STA.b $20
	LDA.w #$0800
	LDY.b #$00
	JSL.l CODE_dma_init_gen_purpose
	SEP.b #$20
	RTL

;---------------------------------------------------------------------------

CODE_01B292:
CODE_restore_midring_inventory:                ; restore midring-checkpoint snapshot: copy $7E:79A6 -> $03B2 (sprite-state block) and $7E:7BB0 -> $7E:5D98 (egg-inventory snapshot)
	REP.b #$30
	LDX.w #$020C
CODE_01B297:
	LDA.l $7E79A6,x
	STA.w $03B2,x
	DEX
	DEX
	BPL.b CODE_01B297
	STZ.w $7DF6
	LDX.w #$000C
CODE_01B2A8:
	LDA.l $7E7BB0,x
	STA.l $7E5D98,x
	DEX
	DEX
	BPL.b CODE_01B2A8
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_save_egg_inventory.
; Snapshots Yoshi's egg inventory (sprite IDs of all eggs currently
; circling Yoshi) into save-RAM at $7E:5D98 for restore on midring
; restart.
;
; INPUTS:   $7DF6 = number of eggs (count, bytes)
;           $7DF6,x = sprite slot per egg (x = 2..count)
; OUTPUTS:  $7E:5D98 = count
;           $7E:5D98,x = NorSpr sprite-ID per egg slot
; MODIFIES: A, X, processor flags (preserved via PHP/PLP)
; CALLERS:  CODE_victory_state_wait_for_button (gm10 victory finalisation, before transitioning
;           out of the level).
;-------------------------------------------------------------------------
CODE_01B2B7:
CODE_save_egg_inventory:
	PHP
	REP.b #$20
	SEP.b #$10
	LDA.w $7DF6
	STA.l $7E5D98
	BEQ.b CODE_01B2D4
	TAX
CODE_01B2C6:
	LDY.w $7DF6,x
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,y
	STA.l $7E5D98,x
	DEX
	DEX
	BNE.b CODE_01B2C6
CODE_01B2D4:
	PLP
	RTL

;---------------------------------------------------------------------------

CODE_01B2D6:
CODE_restore_egg_inventory:                    ; re-spawn the egg trail from $7E:5D98 snapshot: for each saved egg ID, JSL CODE_spawn_sprite_active to allocate a NorSpr slot, position it on Yoshi and JSL CODE_03BEB9 to attach
	PHP
	REP.b #$20
	SEP.b #$10
	STZ.w $7DF6
	LDA.l $7E5D98
	BEQ.b CODE_01B333
	STA.b $00
	PHD
	LDA.w #$7960
	TCD
	LDX.b #$00
CODE_01B2ED:
	PHX
	LDA.l $7E5D9A,x
	CMP.w #$0029
	BEQ.b CODE_01B323
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_01B323
	TYX
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	STA.w $70E2,x
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.w #$0010
	STA.w $7182,x
	LDA.w $7042,x
	AND.w #$00CF
	ORA.w $6126
	STA.w $7042,x
	STX.b $12
	JSL.l CODE_03BEB9
	STZ.w !RAM_YI_Global_SoundQueueSizeLo
CODE_01B323:
	PLX
	INX
	INX
	CPX.w $0000
	BCC.b CODE_01B2ED
	PLD
	LDA.w #$0000
	STA.l $7E5D98
CODE_01B333:
	PLP
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_load_levelmode_09_settings.
; Specialised level-load path for level-mode 09 == Raphael / Mode-7
; arena. Called from gm0c when levelHeader.LevelModeLo == 9.
;
; Pipeline:
;   1. JSL CODE_load_level_palettes       -- standard pre-init.
;   2. Set zero-page sprite-table base seeds ($10..$14 = $B9..$BD).
;   3. Load 5 special palette tables (DATA_5FE3EA / E40A / E42A / E44A
;      / E46A) into palette mirror rows $00 / $10 / $20 / $30 / $40 and
;      direct VRAM at $702D6C / D8C / DAC / DCC / DEC.
;   4. Set $6EB6/B7/B8/B9 = $2D/$1B/$1C/$34 and direct-page mirrors.
;   5. JSL CODE_load_compressed_gfx_files_l       -- Mode-7 sprite-pos table prep.
;   6. Run DATA_levelmode_index[levelmode] dispatch via CODE_init_scene_regs.
;   7. Set Layer3X/Y = $80, Mode-7 center = $0100/$00F8.
;   8. INC $0C1E + $0C20 (Raphael-cinematic flags).
;   9. JSL CODE_raphael_set_rotation_player_pos -- CODE_raphael_set_rotation_player_pos.
;   10. JSL CODE_spawn_sprite_init -- spawn AmbSpr $000C (Raphael himself? or
;       moon-stomp particles).
;
; INPUTS:   !RAM_YI_Level_LevelHeaderLevelModeLo = $09
; OUTPUTS:  Mode-7 setup complete; Raphael fight ready.
; CALLERS:  CODE_gm0c_level_fadein_and_name at !RAM_YI_Level_LevelHeader
;           LevelModeLo == 9 branch.
;-------------------------------------------------------------------------
CODE_01B335:
CODE_load_levelmode_09_settings:
	JSL.l CODE_load_level_palettes
	LDA.b #$B9
	STA.b $10
	LDA.b #$BA
	STA.b $11
	LDA.b #$BB
	STA.b $12
	LDA.b #$BC
	STA.b $13
	LDA.b #$BD
	STA.b $14
	REP.b #$30
	LDX.w #$0000
CODE_01B352:
	LDA.l DATA_5FE3EA,x
	STA.l YI_Global_PaletteMirror[$00].LowByte,x
	STA.l $702D6C,x
	LDA.l DATA_5FE40A,x
	STA.l YI_Global_PaletteMirror[$10].LowByte,x
	STA.l $702D8C,x
	LDA.l DATA_5FE42A,x
	STA.l YI_Global_PaletteMirror[$20].LowByte,x
	STA.l $702DAC,x
	LDA.l DATA_5FE44A,x
	STA.l YI_Global_PaletteMirror[$30].LowByte,x
	STA.l $702DCC,x
	LDA.l DATA_5FE46A,x
	STA.l YI_Global_PaletteMirror[$40].LowByte,x
	STA.l $702DEC,x
	INX
	INX
	CPX.w #$0020
	BCC.b CODE_01B352
	SEP.b #$20
	LDA.b #$2D
	STA.w $6EB6
	STA.b $15
	LDA.b #$1B
	STA.w $6EB7
	STA.b $16
	LDA.b #$1C
	STA.w $6EB8
	STA.b $17
	LDA.b #$34
	STA.w $6EB9
	STA.b $18
	STA.b $19
	STA.b $1A
	LDA.b #$FF
	STA.w $6EBA
	STA.w $6EBB
	LDY.w #$0154
	JSL.l CODE_load_compressed_gfx_files_l
	SEP.b #$10
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	LDX.w DATA_levelmode_index,y
	JSL.l CODE_init_scene_regs
	REP.b #$20
	LDA.w #$0080
	STA.w !RAM_YI_Global_Layer3XPosLo
	STA.w $6098
	STA.w !RAM_YI_Global_Layer3YPosLo
	STA.w $60A0
	LDA.w #$0100
	STA.w !RAM_YI_Global_Mode7CenterXLo
	LDA.w #$00F8
	STA.w !RAM_YI_Global_Mode7CenterYLo
	INC.w $0C1E
	INC.w $0C20
	JSL.l CODE_raphael_set_rotation_player_pos
	LDA.w #$000C
	JSL.l CODE_spawn_sprite_init
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_raphael_set_rotation_player_pos.
; Per-frame Raphael-arena update: wraps player X around the moon's
; circumference, computes screen-center + rotation angle byte $0D05,
; calls CODE_raphael_set_mode7_rotation to update the Mode-7 matrix.
;
; INPUTS:    !EXRAM_YI_Player_XPosLo, !EXRAM_YI_Player_CurrentStateLo
; OUTPUTS:   !EXRAM_YI_Player_XPosLo wrapped to $0120..$0260 range
;            $0D05 = rotation angle byte (0..$FF)
;            $0C23 = camera X = PlayerX - $0078
;            !RAM_YI_Global_Layer1XPosLo = same
;            $6094, !RAM_YI_Global_Layer1YPosLo, $609C, $0C27 = Y mirrors
;            Mode-7 matrix updated (via CODE_raphael_set_mode7_rotation)
; MODIFIES:  A, X (preserved via PHX/PLX inside helper), Y
; CALLERS:   CODE_load_levelmode_09_settings (once); also called per-frame
;            during Raphael fight by the main level-frame pipeline.
;-------------------------------------------------------------------------
CODE_01B403:
CODE_raphael_set_rotation_player_pos:
	JSL.l CODE_raphael_set_mode7_rotation
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.w #!Define_YI_PlayerState20_EnteringRaphaelBossRoom
	BEQ.b CODE_01B47B
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	CMP.w #$0120
	BPL.b CODE_01B41B
	CLC
	ADC.w #$0140
CODE_01B41B:
	CMP.w #$0260
	BMI.b CODE_01B424
	SEC
	SBC.w #$0140
CODE_01B424:
	STA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0120
	SEP.b #$20
	STA.w !REGISTER_Multiplicand
	LDY.b #$CD
	STY.w !REGISTER_Multiplier
	NOP #2
	LDA.b #$A0
	CLC
	ADC.w !REGISTER_ProductOrRemainderLo
	LDA.w !REGISTER_ProductOrRemainderHi
	ADC.b #$00
	PHA
	XBA
	STA.w !REGISTER_Multiplicand
	STY.w !REGISTER_Multiplier
	NOP #2
	PLA
	CLC
	ADC.w !REGISTER_ProductOrRemainderLo
	SEC
	SBC.b #$1A
	AND.b #$FF
	STA.w $0D05
	REP.b #$20
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w #$0078
	STA.w $0C23
	STA.w !RAM_YI_Global_Layer1XPosLo
	STA.w $6094
	LDA.w $60A0
	CLC
	ADC.w #$0026
	STA.w $0C27
	STA.w !RAM_YI_Global_Layer1YPosLo
	STA.w $609C
CODE_01B47B:
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_raphael_set_mode7_rotation.
; Looks up Mode-7 rotation matrix elements (A,D = cos; B = sin; C = -sin)
; from the cos/sin tables at $00:E954 and $00:E9D4, indexed by
; $0D05 (rotation angle byte) << 1.
;
; INPUTS:   $0D05 = rotation angle 0..$FF
; OUTPUTS:  !RAM_YI_Global_Mode7MatrixParameterALo = cos
;           ...ParameterDLo = cos
;           ...ParameterBLo = sin
;           ...ParameterCLo = -sin
; MODIFIES: A, X (preserved), Y (X=16-bit during table lookup)
; CALLERS:  CODE_raphael_set_rotation_player_pos (every frame of Raphael)
;-------------------------------------------------------------------------
CODE_01B47C:
CODE_raphael_set_mode7_rotation:
	PHX
	LDA.w $0D05
	AND.w #$00FF
	ASL
	REP.b #$10
	TAX
	LDA.l DATA_cosine_lut_8bit_radians,x
	STA.w !RAM_YI_Global_Mode7MatrixParameterALo
	STA.w !RAM_YI_Global_Mode7MatrixParameterDLo
	LDA.l DATA_sine_lut_8bit_radians,x
	STA.w !RAM_YI_Global_Mode7MatrixParameterBLo
	EOR.w #$FFFF
	INC
	STA.w !RAM_YI_Global_Mode7MatrixParameterCLo
	SEP.b #$10
	PLX
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_load_3d_sprite_graphic.
; Specialised graphics-loader for the "3D sprite tileset" used in
; certain BG1-tileset-3 levels. Two DMA bursts:
;   - VRAM $4280, size $0080, from FX-graphics ROM $52:1D80
;   - VRAM $4380, size $0080, from FX-graphics ROM $52:1F80
; INPUTS:    (none -- fixed source + dest)
; OUTPUTS:   VRAM $4280 / $4380 = 3D-sprite tile data
; MODIFIES:  A, X, Y, !REGISTER_VRAMAddressIncrementValue, DMA[0] regs
; CALLERS:   CODE_gm0c_level_fadein_and_name if BG1 tileset = 3.
;-------------------------------------------------------------------------
CODE_01B4A3:
CODE_load_3d_sprite_graphic:
	REP.b #$20
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDX.b #FXDATA_520000+$1D80>>16
	STX.w DMA[$00].SourceBank
	LDY.b #$01
	LDA.w #$4280
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #FXDATA_520000+$1D80
	STA.w DMA[$00].SourceLo
	LDA.w #$0080
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	STA.w DMA[$00].SizeLo
	LDA.w #$4380
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #FXDATA_520000+$1F80
	STA.w DMA[$00].SourceLo
	STY.w !REGISTER_DMAEnable
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_gm0d_level_fadein_post_pipe_or_door.
; GAMEMODE $0D entry: level fade-in after entering a pipe/door (skips
; the level-name display since the player has already played the level).
;
; Pipeline:
;   - Sets FreezeYoshi + FreezeSprites = 1.
;   - JSL CODE_gm0f_core_init (gm0f core init -- camera/HDMA setup).
;   - Each frame, runs SuperFX FXCODE_088E48 to render a vertical
;     "pipe/door iris-open" reveal at ($0B4A, $0B4C). $0B4C advances
;     by 8 per frame; when it reaches $0101, INC $0B4A; when $0B4A
;     reaches 2, the iris is done -> clears window masks, disables
;     HDMA $20, INC CurrentGameMode (to $0E or $0F).
;   - Otherwise (iris in progress): copies DMA-target $7E:56D0 ->
;     $70:3A02 ($0348 bytes), sets window masks to $1F (full window),
;     enables HDMA $20.
;
; INPUTS:    $0B4A / $0B4C = iris progress
; OUTPUTS:   On completion: !EXRAM_YI_Level_FreezeYoshiFlagLo +
;            FreezeSpritesFlagLo = 0, gamemode advanced.
; MODIFIES:  A, X, Y; window masks; HDMA enable.
; CALLERS:   Master gamemode dispatcher.
;-------------------------------------------------------------------------
CODE_01B4E1:
CODE_gm0d_level_fadein_post_pipe_or_door:
	LDA.b #$01
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	JSL.l CODE_gm0f_core_init
	REP.b #$20
	LDA.w $0B4A
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	INC
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $0B4C
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_088E48>>16
	LDA.w #FXCODE_088E48
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w $0B4C
	CLC
	ADC.w #$0008
	STA.w $0B4C
	CMP.w #$0101
	BCC.b CODE_01B548
	STZ.w $0B4C
	INC.w $0B4A
	LDA.w $0B4A
	CMP.w #$0002
	BCC.b CODE_01B548
	SEP.b #$20
	STZ.w !RAM_YI_Global_MainScreenWindowMask
	STZ.w !RAM_YI_Global_SubScreenWindowMask
	STZ.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STZ.w !RAM_YI_Global_BG3And4WindowMaskSettings
	STZ.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDA.b #$20
	TRB.w !RAM_YI_Global_HDMAEnable
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	INC.w !RAM_YI_Global_CurrentGameMode
	JML.l CODE_increment_gamemode

CODE_01B548:
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	SEP.b #$20
	LDA.b #$1F
	STA.w !RAM_YI_Global_MainScreenWindowMask
	STA.w !RAM_YI_Global_SubScreenWindowMask
	LDA.b #$33
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STA.w !RAM_YI_Global_BG3And4WindowMaskSettings
	STA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	STZ.w !RAM_YI_Global_BGWindowLogicSettings
	STZ.w !REGISTER_ColorAndObjectWindowLogicSettings
	LDA.b #$20
	TSB.w !RAM_YI_Global_HDMAEnable
	LDA.b #$0F
	STA.w $0200
	LDA.b #$01
	STA.w $0201
	PLB
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_gm10_victory_cutscene.
; GAMEMODE $10 entry: post-boss-defeat victory cutscene + score screen.
; Dispatches via $0B57 (cutscene state index) into DATA_01B593 (31
; entries, each a sub-state of the victory animation).
;
; For state values < $0D, JSL CODE_gm0f_core_init (gm0f core init -- camera).
; Then JSR (DATA_01B593-1, x) (X = $0B57 byte-index, table is dw,
; so each entry handles its own advance of $0B57).
;
; The 31 states cover: fade, score-tile build, "TIME BONUS" reveal,
; star count-up sound (CODE_victory_state_star_count_up), red-coin count-up (CODE_victory_state_red_coin_count_up),
; flower count-up (CODE_victory_state_flower_count_up), score-total (CODE_victory_state_write_score_value), and the
; final game-mode advance (CODE_victory_state_wait_for_button -> save high-score).
;
; INPUTS:   $0B57 = cutscene state index (counts up by 2 per state).
; OUTPUTS:  When done ($0B57 >= terminal), advances to gamemode $1F or
;           $29 (bonus or normal level-clear), saves high-score.
; CALLERS:  Master gamemode dispatcher.
;-------------------------------------------------------------------------
CODE_01B580:
CODE_gm10_victory_cutscene:
	LDX.w $0B57
	CPX.b #$0D
	BCS.b CODE_01B58E
	JSL.l CODE_gm0f_core_init
	LDX.w $0B57
CODE_01B58E:
	JSR.w (DATA_01B593-$01,x)
	PLB
	RTL

DATA_01B593:
	dw CODE_01E2BF
	dw CODE_victory_state_noop
	dw CODE_victory_state_noop
	dw CODE_victory_state_re_enable_hdma
	dw CODE_gm31_state_shrink_window
	dw CODE_gm31_state_setup_score_bg
	dw CODE_victory_init_score_tilemap
	dw CODE_01B6B9
	dw CODE_01B6C9
	dw CODE_01B95B
	dw CODE_01B9BA
	dw CODE_gm31_state_finalise_window
	dw CODE_victory_state_pause_n_frames
	dw CODE_victory_state_star_count_up
	dw CODE_victory_state_pause_n_frames
	dw CODE_victory_state_red_coin_count_up
	dw CODE_victory_state_pause_n_frames
	dw CODE_victory_state_flower_count_up
	dw CODE_victory_state_pause_n_frames
	dw CODE_victory_state_branch_on_score
	dw CODE_victory_state_pause_n_frames
	dw CODE_victory_state_write_score_label
	dw CODE_victory_state_pause_n_frames
	dw CODE_victory_state_write_best_score_label
	dw CODE_victory_state_pause_n_frames
	dw CODE_victory_state_announce_perfect
	dw CODE_victory_state_write_perfect_label
	dw CODE_victory_state_pause_n_frames
	dw CODE_victory_state_write_score_value
	dw CODE_victory_state_write_pts_suffix
	dw CODE_victory_state_wait_for_button

;---------------------------------------------------------------------------

CODE_01B5D1:
CODE_victory_state_advance:                  ; shared helper: bump $0B57 by 2 then return (advance to next victory-cutscene state)
	INC.w $0B57
	INC.w $0B57
CODE_01B5D7:
CODE_victory_state_noop:                     ; bare RTS slot used by DATA_01B593 entries 2/3 ("wait one frame")
	RTS

;---------------------------------------------------------------------------

CODE_01B5D8:
CODE_victory_state_re_enable_hdma:           ; victory state $03: snapshot HDMAEnable, run CODE_gm31_state_expand_window, OR snapshot back in
	LDA.w !RAM_YI_Global_HDMAEnable
	PHA
	JSR.w CODE_gm31_state_expand_window
	PLA
	TSB.w !RAM_YI_Global_HDMAEnable
	RTS

;---------------------------------------------------------------------------

CODE_01B5E4:
CODE_victory_init_score_tilemap:             ; victory state $06: blank-fill BG3 tilemap rows ($7E:5DA6-$7E:6126) with empty-tile $017F, then DMA score-bar templates from DATA_score_screen_sep_tiles/01B689 into staging
	REP.b #$20
	PHB
	LDX.b #$7E5DA6>>16
	PHX
	PLB
	LDX.b #$00
	LDA.w #$017F
CODE_01B5F0:
	STA.w $7E5DA6,x
	STA.w $7E5EA6,x
	STA.w $7E5FA6,x
	STA.w $7E60A6,x
	STA.w $7E6126,x
	DEX
	DEX
	BNE.b CODE_01B5F0
	PLB
	LDX.b #$00
CODE_01B606:
	LDA.w DATA_score_screen_sep_tiles,x
	STA.l $7E5E2E,x
	LDA.w DATA_01B689,x
	STA.l $7E60EE,x
	INX
	INX
	CPX.b #$30
	BCC.b CODE_01B606
	LDA.w #$0004
	STA.w !RAM_YI_Level_LevelHeaderAnimationTilesetLo
	STZ.w !RAM_YI_Level_LevelHeaderAnimationPaletteLo
	SEP.b #$20
	LDA.b #$0C
	STA.w $0127
	JMP.w CODE_victory_state_advance

;---------------------------------------------------------------------------

DATA_01B62D:
	dw $6800,$40BF,$18EE
	dw $68A0,$447F,$1A11
	dw $6860,$C029,$18EE
	dw $6861,$C029,$18EE
	dw $687E,$C029,$18EE
	dw $687F,$C029,$18EE
	dw $6B00,$413F,$18EE
	dw $FFFF

;---------------------------------------------------------------------------

DATA_01B659:
DATA_score_screen_sep_tiles:
	dw $0145,$0146,$8145,$C146,$4145,$4146,$0145,$0146
	dw $8145,$8146,$4145,$0146,$0145,$8146,$0145,$0146
	dw $0145,$0146,$8145,$C146,$0145,$0146,$8145,$0146

DATA_01B689:
	dw $0145,$0146,$8145,$8146,$0145,$0146,$0145,$0146
	dw $8145,$8146,$0145,$8146,$0145,$8146,$8145,$0146
	dw $4145,$0146,$8145,$0146,$0145,$8146,$0145,$0146

;---------------------------------------------------------------------------

CODE_01B6B9:
	LDA.b #$18
	STA.w $0127
	JMP.w CODE_victory_state_advance

DATA_01B6C1:
	dw $3400,$47FF,$117F
	dw $FFFF

CODE_01B6C9:
	REP.b #$30
	LDX.w #$000A
	LDY.w #$0000
	STZ.b $00
CODE_01B6D3:
	LDA.w DATA_score_strings,y
	JSR.w CODE_01B785
	CPY.w #$0016
	BCC.b CODE_01B6D3
	JSR.w CODE_01B7A1
	JSR.w CODE_01B7B3
	JSR.w CODE_01B7C5
	LDX.w #$03CE
	LDY.w #$0000
	STZ.b $00
CODE_01B6EF:
	LDA.w DATA_01B835,y
	JSR.w CODE_01B785
	CPY.w #$0015
	BCC.b CODE_01B6EF
	SEP.b #$30
	LDX.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.w !RAM_YI_Map_LevelHighScores,x
	REP.b #$30
	AND.w #$00FF
	STA.w $030C
	STZ.b $00
	LDA.w $030C
	CMP.w #$0064
	BCC.b CODE_01B71C
	LDA.w #$000B
	STA.b $00
	DEC
	BRA.b CODE_01B728

CODE_01B71C:
	CMP.w #$000A
	BCC.b CODE_01B728
	INC.b $00
	SBC.w #$000A
	BRA.b CODE_01B71C

CODE_01B728:
	ASL
	TAY
	LDA.w DATA_01B8AF,y
	STA.l $7E5DD4
	LDA.w DATA_01B92D,y
	STA.l $7E5E14
	LDA.b $00
	ASL
	TAY
	LDA.w DATA_01B8AF,y
	STA.l $7E5DD2
	LDA.w DATA_01B92D,y
	STA.l $7E5E12
	LDA.w #DATA_568000+$5000>>16
	STA.b $01
	LDY.w #$2800
	LDX.w #DATA_568000+$5000
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDA.w #FXDATA_520000+$1E00>>16
	STA.b $01
	LDY.w #$1000
	LDX.w #FXDATA_520000+$1E00
	LDA.w #$0100
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDA.w #FXDATA_520000+$1EC0>>16
	STA.b $01
	LDY.w #$1100
	LDX.w #FXDATA_520000+$1EC0
	LDA.w #$0100
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	JMP.w CODE_victory_state_advance

CODE_01B785:
	PHY
	AND.w #$00FF
	TAY
	LDA.w DATA_score_char_tiles,y
	ORA.b $00
	STA.l $7E5DA6,x
	LDA.w DATA_01B8DD,y
	ORA.b $00
	STA.l $7E5DE6,x
	INX
	INX
	PLY
	INY
	RTS

CODE_01B7A1:
	LDX.w #$0108
	LDY.w #$0000
CODE_01B7A7:
	LDA.w DATA_01B7ED,y
	JSR.w CODE_01B785
	CPY.w #$0018
	BCC.b CODE_01B7A7
	RTS

CODE_01B7B3:
	LDX.w #$01C8
	LDY.w #$0000
CODE_01B7B9:
	LDA.w DATA_01B805,y
	JSR.w CODE_01B785
	CPY.w #$0018
	BCC.b CODE_01B7B9
	RTS

CODE_01B7C5:
	LDX.w #$0288
	LDY.w #$0000
CODE_01B7CB:
	LDA.w DATA_01B81D,y
	JSR.w CODE_01B785
	CPY.w #$0018
	BCC.b CODE_01B7CB
	RTS

DATA_01B7D7:
DATA_score_strings:
	dw $3C3A,$0E4E,$0C10,$4E0E,$0424,$221C,$3608,$3636
	dw $5436,$4E5C,$3C3A

DATA_01B7ED:
	dw $403E,$244E,$0026,$2422,$3636,$3636,$3636,$3450
	dw $5056,$6A68,$504E,$6E6C

DATA_01B805:
	dw $4846,$044E,$101C,$241A,$3636,$3636,$3636,$3450
	dw $5054,$6A68,$504E,$6E6C

DATA_01B81D:
	dw $4442,$0A4E,$1C16,$082C,$2422,$3636,$3636,$5036
	dw $5A34,$6A68,$504E,$6E6C

DATA_01B835:
	db $26,$1C,$26,$00,$16,$4E,$1E,$1C,$10,$1A,$26,$24,$36,$36,$36,$36
	db $36,$36,$50,$6C,$6E

DATA_01B84A:
	db $4E,$0E,$10,$0C,$0E,$4E,$24,$04,$1C,$22,$08,$36,$36,$36,$36,$36
	db $36,$36,$50,$6C,$6E

DATA_01B85F:
DATA_score_char_tiles:
	dw $010A,$010B,$010C,$010D,$010E,$4106,$0120,$0121
	dw $0122,$0123,$0124,$C116,$0126,$0127,$0109,$0128
	dw $0129,$0128,$4102,$012C,$012D,$012E,$8136,$0101
	dw $0101,$0142,$0144,$0143,$017F,$012A,$012B,$0548
	dw $0549,$054A,$054B,$054C,$054D,$054E,$054F,$017F

DATA_01B8AF:
	dw $0109,$0100,$0102,$0102,$0103,$0104,$0105,$0106
	dw $0107,$C115,$0168,$0167,$0175,$0176,$017F,$017F
	dw $01C4,$010F,$01D6,$0164,$0174,$016E,$017F
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	dw $017F
endif

DATA_01B8DD:
	dw $011A,$011B,$011C,$011D,$011E,$011F,$0130,$0131
	dw $0132,$0133,$0134,$C106,$0136,$0137,$0119,$0138
	dw $0139,$0140,$0112,$013C,$013D,$013E,$8126,$0111
	dw $013C,$C142,$C144,$017F,$0141,$013A,$013B,$0508
	dw $0518,$0525,$0535,$052F,$053F,$050F,$0547,$017F

DATA_01B92D:
	dw $0119,$0110,$C142,$0112,$0113,$0114,$0115,$0116
	dw $0117,$C105,$0178,$0177,$0179,$017A,$015F,$017B
	dw $01D4,$013D,$01D7,$011E,$011E,$017E,$0158
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	dw $014F
endif

;---------------------------------------------------------------------------

CODE_01B95B:
	REP.b #$20
	STZ.w $0392
	STZ.w $0B5F
	STZ.w $0B61
	STZ.w $0B63
	STZ.w $0381
	SEP.b #$20
	LDA.b #$0F
	STA.w $0127
	JMP.w CODE_victory_state_advance

;---------------------------------------------------------------------------

DATA_01B976:
	dw $6862,$0001,$1A02
	dw $6863,$4033,$1A03
	dw $687D,$0001,$1A04
	dw $6882,$C025,$1A05
	dw $6883,$0001,$1A00
	dw $6884,$4031,$1A01
	dw $689D,$C025,$1A15
	dw $68A3,$C023,$1A10
	dw $6AE2,$0001,$1A12
	dw $6AE3,$4033,$1A13
	dw $6AFD,$0001,$1A14
	dw $FFFF

CODE_01B9BA:
	REP.b #$30
	LDA.w #$7E5DA6>>16
	STA.b $01
	LDY.w #$34A0
	LDX.w #$7E5DA6
	LDA.w #$0480
	JSL.l CODE_vram_dma_queue_add_180_2118
	LDX.w #$001C
CODE_01B9D1:
	LDA.l DATA_5FC094,x
	STA.l YI_Global_PaletteMirror[$01].LowByte,x
	LDA.l DATA_5FB31A,x
	STA.l YI_Global_PaletteMirror[$61].LowByte,x
	LDA.l DATA_5FB33A,x
	STA.l YI_Global_PaletteMirror[$71].LowByte,x
	DEX
	DEX
	BPL.b CODE_01B9D1
	STZ.b !RAM_YI_Global_Layer1XPosLo
	STZ.b !RAM_YI_Global_Layer1YPosLo
	STZ.b !RAM_YI_Global_Layer3XPosLo
	STZ.b !RAM_YI_Global_Layer3YPosLo
	STZ.w $0948
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$00].LowByte
	STZ.w $0B5B
	STZ.w $0B5D
	SEP.b #$30
	LDA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	AND.b #$0F
	STA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDA.b #$04
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$01
	STA.w !RAM_YI_Global_SubScreenLayers
	JMP.w CODE_victory_state_advance

CODE_01BA1C:
CODE_victory_state_pause_n_frames:           ; victory inter-count-up wait: tick $038B; on $0 advance state; cap at $29 to stop chaining
	JSR.w CODE_01BEE4
	DEC.w $038B
	BNE.b CODE_01BA2E
	JSR.w CODE_victory_state_advance
	LDA.w $0B57
	CMP.b #$29
	BCS.b CODE_01BA2E
CODE_01BA2E:
	RTS

;---------------------------------------------------------------------------

CODE_01BA2F:
CODE_victory_state_star_count_up:            ; victory count-up: drain StarTimer by 10 per frame, render the rolling number on the score tilemap, play "pulley squeak" sfx; jumps past red-coin / flower stages when those counts are zero
	JSR.w CODE_01BEE4
	REP.b #$30
	LDA.w !RAM_YI_Level_StarTimerLo
	SEC
	SBC.w #$000A
	STA.w !RAM_YI_Level_StarTimerLo
	BPL.b CODE_01BA69
	STZ.w !RAM_YI_Level_StarTimerLo
	SEP.b #$30
	LDA.b #$20
	STA.w $038B
	LDA.w !RAM_YI_Level_RedCoinsCollectedLo
	ORA.w !RAM_YI_Level_RedCoinsCollectedHi
	BNE.b CODE_01BA66
	JSR.w CODE_victory_state_advance
	JSR.w CODE_victory_state_advance
	LDA.w !RAM_YI_Level_FlowersCollectedLo
	ORA.w $03B9
	BNE.b CODE_01BA66
	JSR.w CODE_victory_state_advance
	JSR.w CODE_victory_state_advance
CODE_01BA66:
	JMP.w CODE_victory_state_advance

CODE_01BA69:
	STZ.b $02
	INC.w $0392
	STZ.w $0392
	LDA.w $0B5F
	INC
	CMP.w #$001E
	BCC.b CODE_01BA89
	LDA.w #$0400
	STA.b $00
	STA.b $02
	JSR.w CODE_01B7A1
	LDA.w #$001E
	BRA.b CODE_01BA95

CODE_01BA89:
	PHA
	SEP.b #$30
	LDA.b #!Define_YI_SoundID5A_PulleySqueak
	JSL.l CODE_push_sound_queue
	REP.b #$30
	PLA
CODE_01BA95:
	STA.w $0B5F
	LDX.w #$0000
CODE_01BA9B:
	CMP.w #$000A
	BCC.b CODE_01BAA6
	INX
	SBC.w #$000A
	BRA.b CODE_01BA9B

CODE_01BAA6:
	STA.b $00
	LDA.w #$7E5EC8>>16
	STA.b $06
	STA.b $09
	STA.b $12
	STA.b $15
	LDA.w #$7E5EC8
	STA.b $04
	CLC
	ADC.w #$000E
	STA.w $0010
	LDA.w #$7E5F08
	STA.b $07
	CLC
	ADC.w #$000E
	STA.b $13
	JSR.w CODE_victory_render_digit_pair
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

CODE_01BAD0:
CODE_victory_state_red_coin_count_up:        ; victory count-up: decrement RedCoinsCollected once per frame, render running total, advance to flowers when at zero (skip flowers state if FlowersCollected is also zero)
	JSR.w CODE_01BEE4
	REP.b #$30
	LDA.w $0B61
	CMP.w #$0014
	BCS.b CODE_01BAE5
	DEC.w !RAM_YI_Level_RedCoinsCollectedLo
	LDA.w !RAM_YI_Level_RedCoinsCollectedLo
	BPL.b CODE_01BAFD
CODE_01BAE5:
	SEP.b #$30
	LDA.b #$20
	STA.w $038B
	LDA.w !RAM_YI_Level_FlowersCollectedLo
	ORA.w $03B9
	BNE.b CODE_01BAFA
	JSR.w CODE_victory_state_advance
	JSR.w CODE_victory_state_advance
CODE_01BAFA:
	JMP.w CODE_victory_state_advance

CODE_01BAFD:
	STZ.b $02
	LDA.w $0B61
	INC
	CMP.w #$0014
	BCC.b CODE_01BB17
	LDA.w #$0400
	STA.b $00
	STA.b $02
	JSR.w CODE_01B7B3
	LDA.w #$0014
	BRA.b CODE_01BB23

CODE_01BB17:
	PHA
	SEP.b #$30
	LDA.b #!Define_YI_SoundID5A_PulleySqueak
	JSL.l CODE_push_sound_queue
	REP.b #$30
	PLA
CODE_01BB23:
	STA.w $0B61
	LDX.w #$0000
CODE_01BB29:
	CMP.w #$000A
	BCC.b CODE_01BB34
	INX
	SBC.w #$000A
	BRA.b CODE_01BB29

CODE_01BB34:
	STA.b $00
	LDA.w #$7E5F88>>16
	STA.b $06
	STA.b $09
	STA.b $12
	STA.b $15
	LDA.w #$7E5F88
	STA.b $04
	CLC
	ADC.w #$000E
	STA.b $10
	LDA.w #$7E5FC8
	STA.b $07
	CLC
	ADC.w #$000E
	STA.b $13
	JSR.w CODE_victory_render_digit_pair
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

CODE_01BB5D:
CODE_victory_state_flower_count_up:          ; victory count-up: decrement FlowersCollected once per frame, render running total (+10 per flower into $0B63), play sound $5A
	JSR.w CODE_01BEE4
	REP.b #$30
	DEC.w !RAM_YI_Level_FlowersCollectedLo
	LDA.w !RAM_YI_Level_FlowersCollectedLo
	BPL.b CODE_01BB77
	STZ.w !RAM_YI_Level_FlowersCollectedLo
	SEP.b #$30
	LDA.b #$20
	STA.w $038B
	JMP.w CODE_victory_state_advance

CODE_01BB77:
	STZ.b $02
	LDA.w $0B63
	CLC
	ADC.w #$000A
	STA.w $0B63
	LDX.w #$0000
CODE_01BB86:
	CMP.w #$000A
	BCC.b CODE_01BB91
	INX
	SBC.w #$000A
	BRA.b CODE_01BB86

CODE_01BB91:
	CPX.w #$0005
	BCC.b CODE_01BBA2
	PHX
	LDA.w #$0400
	STA.b $00
	STA.b $02
	JSR.w CODE_01B7C5
	PLX
CODE_01BBA2:
	LDA.w #$FFFF
	STA.b $00
	LDA.w #$7E604C>>16
	STA.b $06
	STA.b $09
	STA.b $12
	STA.b $15
	LDA.w #$7E604C
	STA.b $04
	CLC
	ADC.w #$000A
	STA.b $10
	LDA.w #$7E608C
	STA.b $07
	CLC
	ADC.w #$000A
	STA.b $13
	JSR.w CODE_victory_render_digit_pair
	SEP.b #$30
	LDA.b #!Define_YI_SoundID5A_PulleySqueak
	JSL.l CODE_push_sound_queue
	RTS

;---------------------------------------------------------------------------

CODE_01BBD4:
CODE_victory_render_digit_pair:              ; shared helper used by star/red-coin/flower count-up: writes two-tile digit (ones+tens) from DATA_01B8AF/01B92D into score-screen tilemap at the four ptrs in $04/$07/$10/$13
	PHX
	TXA
	BEQ.b CODE_01BBEC
	ASL
	TAX
	LDA.w DATA_01B8AF,x
	ORA.b $02
	STA.b [$04]
	STA.b [$10]
	LDA.w DATA_01B92D,x
	ORA.b $02
	STA.b [$07]
	STA.b [$13]
CODE_01BBEC:
	LDY.w #$0002
	LDA.b $00
	BMI.b CODE_01BC07
	ASL
	TAX
	LDA.w DATA_01B8AF,x
	ORA.b $02
	STA.b [$04],y
	STA.b [$10],y
	LDA.w DATA_01B92D,x
	ORA.b $02
	STA.b [$07],y
	STA.b [$13],y
CODE_01BC07:
	PLX
	LDA.b $00
	BPL.b CODE_01BC0E
	STZ.b $00
CODE_01BC0E:
	INC.b $00
	LDA.b $13
	CLC
	ADC.w #$0006
	STA.b $13
	JSR.w CODE_score_pluralize_pts
	STZ.b $00
	STZ.b $02
	LDX.w #$0004
	LDA.w $0B5F
	CLC
	ADC.w $0B61
	CLC
	ADC.w $0B63
	CMP.w #$0064
	BCC.b CODE_01BC35
	LDA.w #$0064
CODE_01BC35:
	STA.w $0381
	CMP.w #$0064
	BCC.b CODE_01BC45
	LDA.w #$000B
	STA.b $00
	DEC
	BRA.b CODE_01BC51

CODE_01BC45:
	CMP.w #$000A
	BCC.b CODE_01BC51
	INC.b $00
	SBC.w #$000A
	BRA.b CODE_01BC45

CODE_01BC51:
	ASL
	TAX
	LDA.w DATA_01B8AF,x
	STA.l $7E6198
	LDA.w DATA_01B92D,x
	STA.l $7E61D8
	LDA.b $00
	BEQ.b CODE_01BC75
CODE_01BC65:
	ASL
	TAY
	LDA.w DATA_01B8AF,y
	STA.l $7E6196
	LDA.w DATA_01B92D,y
	STA.l $7E61D6
CODE_01BC75:
	LDA.b $02
	ASL
	TAY
	BEQ.b CODE_01BC89
	LDA.w DATA_01B8AF,y
	STA.l $7E6194
	LDA.w DATA_01B92D,y
	STA.l $7E61D4
CODE_01BC89:
	TXA
	ORA.b $02
	TAX
	STZ.b $02
	LDA.w #$61DC
	STA.b $13
	JSR.w CODE_score_pluralize_pts
	LDA.w #$7E5DA6>>16
	STA.b $01
	LDY.w #$34A0
	LDX.w #$7E5DA6
	LDA.w #$0480
	JSL.l CODE_vram_dma_queue_add_180_2118
	RTS

;---------------------------------------------------------------------------

CODE_01BCAA:
CODE_score_pluralize_pts:
	TXA
	BNE.b CODE_01BCB5
	LDA.b $00
	BEQ.b CODE_01BCBC
	DEC
	DEC
	BEQ.b CODE_01BCBC
CODE_01BCB5:
	LDA.w #$016F
	ORA.b $02
	STA.b [$13]
CODE_01BCBC:
	RTS

;---------------------------------------------------------------------------

CODE_01BCBD:
CODE_victory_state_branch_on_score:          ; choose state $29 (next count-up) or $2D (high-score path) depending on whether current score $0381 beats personal best $030C
	JSR.w CODE_01BEE4
	LDA.b #$30
	STA.w $038B
	REP.b #$30
	STZ.w $03BA
	LDX.w #$0029
	LDA.w $0381
	BMI.b CODE_01BCDA
	CMP.w $030C
	BCC.b CODE_01BCDA
	LDX.w #$002D
CODE_01BCDA:
	STX.w $0B57
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

DATA_01BCE0:
	dw $6218,$621A,$621C,$61DA,$621A,$621C

DATA_01BCEC:
	dw $0555,$0556,$0557,$015F,$0565,$0566

CODE_01BCF8:
CODE_victory_state_write_score_label:        ; victory: write 6 tiles of the "SCORE" label one per frame from DATA_01BCE0/01BCEC into BG3 tilemap
	JSR.w CODE_01BEE4
	LDA.b #$7E
	STA.b $02
	REP.b #$30
	LDA.w $03BA
	AND.w #$00FE
	TAX
	CPX.w #$000C
	BCC.b CODE_01BD15
	LDA.w #$003D
	STA.w $0B57
	BRA.b CODE_01BD25

CODE_01BD15:
	LDA.w DATA_01BCE0,x
	STA.b $00
	LDA.w DATA_01BCEC,x
	STA.b [$00]
	INC.w $03BA
	JSR.w CODE_01BC89
CODE_01BD25:
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

DATA_01BD28:
	dw $6218,$6216,$6214,$61D4,$6194,$6156,$6158,$615A
	dw $619A,$61DA

DATA_01BD3C:
	dw $0562,$0561,$0560,$0563,$0553,$0550,$0551,$0552
	dw $0554,$015F

CODE_01BD50:
CODE_victory_state_write_best_score_label:   ; victory: write 10 tiles of the "BEST SCORE" label one per frame from DATA_01BD28/01BD3C; if current score exactly $0064 it forks to "PERFECT BONUS" label
	JSR.w CODE_01BEE4
	LDA.b #$7E
	STA.b $02
	LDA.b #$30
	STA.w $038B
	REP.b #$30
	LDA.w $03BA
	AND.w #$00FE
	TAX
	CPX.w #$0014
	BCC.b CODE_01BD80
	LDX.w #$0037
	LDA.w $0381
	CMP.w #$0064
	BNE.b CODE_01BD7B
	STZ.w $03BA
	LDX.w #$0031
CODE_01BD7B:
	STX.w $0B57
	BRA.b CODE_01BD90

CODE_01BD80:
	LDA.w DATA_01BD28,x
	STA.b $00
	LDA.w DATA_01BD3C,x
	STA.b [$00]
	INC.w $03BA
	JSR.w CODE_01BC89
CODE_01BD90:
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

DATA_01BD93:
	dw $6218,$6216,$6214,$61D4,$6194,$6154,$6156,$6158
	dw $615A,$619A,$61DA,$621A

DATA_01BDAB:
	dw $056B,$056A,$0569,$056D,$055D,$0559,$055A,$055B
	dw $055C,$055E,$015F,$056C

CODE_01BDC3:
CODE_victory_state_announce_perfect:         ; perfect-score entry: play sound $95 (BonusChallenge), advance state, then fall through into the label writer
	LDA.b #!Define_YI_SoundID95_BonusChallenge
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	JSR.w CODE_victory_state_advance
CODE_01BDCA:
CODE_victory_state_write_perfect_label:      ; victory: write 12 tiles of the "PERFECT BONUS" label one per frame from DATA_01BD93/01BDAB
	JSR.w CODE_01BEE4
	LDA.b #$7E
	STA.b $02
	REP.b #$30
	LDA.w $03BA
	AND.w #$00FE
	TAX
	CPX.w #$0018
	BCC.b CODE_01BDED
	LDA.w #$0037
	STA.w $0B57
	LDA.w #$0030
	STA.w $038B
	BRA.b CODE_01BDFD

CODE_01BDED:
	LDA.w DATA_01BD93,x
	STA.b $00
	LDA.w DATA_01BDAB,x
	STA.b [$00]
	INC.w $03BA
	JSR.w CODE_01BC89
CODE_01BDFD:
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

CODE_01BE00:
CODE_victory_state_write_score_value:        ; victory: write current score $0381 as 2 decimal digits into BG3 tilemap (and cache to $030C as new high-score); skip to gameover if score < old high-score
	JSR.w CODE_01BEE4
	REP.b #$30
	LDA.w $0381
	CMP.w $030C
	BCS.b CODE_01BE15
	LDA.w #$003D
	STA.w $0B57
	BRA.b CODE_01BE60

CODE_01BE15:
	STA.w $030C
	STZ.b $00
	CMP.w #$0064
	BCC.b CODE_01BE27
	LDA.w #$000B
	STA.b $00
	DEC
	BRA.b CODE_01BE33

CODE_01BE27:
	CMP.w #$000A
	BCC.b CODE_01BE33
	INC.b $00
	SBC.w #$000A
	BRA.b CODE_01BE27

CODE_01BE33:
	ASL
	TAY
	LDA.w DATA_01B8AF,y
	STA.l $7E5DD4
	LDA.w DATA_01B92D,y
	STA.l $7E5E14
	LDA.b $00
	ASL
	TAY
	BEQ.b CODE_01BE5A
	LDA.w DATA_01B8AF,y
	STA.l $7E5DD2
	LDA.w DATA_01B92D,y
	STA.l $7E5E12
	JSR.w CODE_01BC89
CODE_01BE5A:
	INC.w $0B57
	INC.w $0B57
CODE_01BE60:
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

CODE_01BE63:
CODE_victory_state_write_pts_suffix:         ; victory: stamp 4 "PTS" suffix tiles ($0570-$0573) into the BG3 tilemap at the two score positions, then advance to gameover state
	REP.b #$30
	LDA.w #$0570
	STA.l $7E5DB0
	STA.l $7E5DD8
	LDA.w #$0572
	STA.l $7E5DF0
	STA.l $7E5E18
	LDA.w #$0571
	STA.l $7E5DB2
	STA.l $7E5DDA
	LDA.w #$0573
	STA.l $7E5DF2
	STA.l $7E5E1A
	JSR.w CODE_01BC89
	INC.w $0B57
	INC.w $0B57
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

CODE_01BE9D:
CODE_victory_state_wait_for_button:          ; final victory state: poll for any face-button press; on press save high-score (JSL CODE_save_egg_inventory), pick gamemode $1F (level-clear) or $29 (bonus-challenge) and fade out music
	JSR.w CODE_01BEE4
	LDA.b $36
	ORA.b $35
	AND.b #$F0
	BEQ.b CODE_01BEE3
	JSL.l CODE_save_egg_inventory
	LDX.b #!Define_YI_GameMode1F
	LDA.w !RAM_YI_Level_DoBonusChallengeFlagLo
	BPL.b CODE_01BEB8
	JSR.w CODE_01BF38
	LDX.b #!Define_YI_GameMode29
CODE_01BEB8:
	STX.w !RAM_YI_Global_CurrentGameMode
	LDA.b #!Define_YI_MusicID_FadeMusicCommand
	STA.b !RAM_YI_Global_PlayMusicLo
	INC.w $0220
	LDX.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.w $030C
	CMP.w !RAM_YI_Map_LevelHighScores,x
	BEQ.b CODE_01BEE0
	BCC.b CODE_01BEE0
	PHA
	LDA.w !RAM_YI_Map_LevelClearFlags,x
	AND.b #$7F
	BEQ.b CODE_01BEDF
	LDA.w !RAM_YI_Map_LevelHighScores,x
	ORA.b #$80
	STA.w $0220
CODE_01BEDF:
	PLA
CODE_01BEE0:
	STA.w !RAM_YI_Map_LevelHighScores,x
CODE_01BEE3:
	RTS

;---------------------------------------------------------------------------

CODE_01BEE4:
	LDA.w $0B57
	CMP.b #$3D
	BCC.b CODE_01BF22
	DEC.w $0B5D
	BPL.b CODE_01BF22
	LDA.b #$05
	STA.w $0B5D
	REP.b #$30
	LDA.w $0B5B
	TAX
	LDA.w DATA_01BF23+$02,x
	AND.w #$00FF
	STA.b $01
	LDY.w #$2800
	LDA.w DATA_01BF23,x
	TAX
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	LDA.w $0B5B
	INC
	INC
	INC
	CMP.b #$09
	BCC.b CODE_01BF1F
	LDA.b #$00
CODE_01BF1F:
	STA.w $0B5B
CODE_01BF22:
	RTS

DATA_01BF23:
	dl DATA_568000+$5000
	dl DATA_568000+$5800
	dl DATA_568000+$6000

;---------------------------------------------------------------------------

DATA_01BF2C:
	db !Define_YI_BonusID_FlipCards,!Define_YI_BonusID_ScratchAndMatch
	db !Define_YI_BonusID_DrawingLots,!Define_YI_BonusID_SlotMachine
	db !Define_YI_BonusID_MatchCards,!Define_YI_BonusID_Roulette
	db !Define_YI_BonusID_DrawingLots,!Define_YI_BonusID_ScratchAndMatch
	db !Define_YI_BonusID_FlipCards,!Define_YI_BonusID_Roulette
	db !Define_YI_BonusID_MatchCards,!Define_YI_BonusID_SlotMachine

CODE_01BF38:
	JSL.l CODE_random_number_gen
	AND.b #$01
	STA.b $00
	LDA.w !RAM_YI_Level_CurrentWorldLo
	CLC
	ADC.b $00
	TAX
	LDA.w DATA_01BF2C,x
	STA.w !RAM_YI_Level_CurrentBonusGame
	CMP.b #!Define_YI_BonusID_Roulette
	BNE.b CODE_01BF5D
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	DEC
	BNE.b CODE_01BF5D
	LDA.w DATA_01BF2C-$01,x
	STA.w !RAM_YI_Level_CurrentBonusGame
CODE_01BF5D:
	RTS

;---------------------------------------------------------------------------

DATA_01BF5E:
	dw FXDATA_520000+$4000,FXDATA_520000+$4040,FXDATA_520000+$4080,FXDATA_520000+$40C0,FXDATA_520000+$4100,FXDATA_520000+$4140,FXDATA_520000+$4180,FXDATA_520000+$41C0
	dw FXDATA_520000+$4400,FXDATA_520000+$4440

DATA_01BF72:
	dw $1600,$1620,$1640,$1660,$1A00,$1A20,$1A40,$1A60
	dw $1A80,$1AA0

DATA_01BF86:
	dw $2612,$2828,$320C,$2020,$32C8,$2030,$72C8,$3020
	dw $B2C8,$3030,$F2C8,$28C8,$320C,$20C0,$32C8,$20D0
	dw $72C8,$30C0,$B2C8,$30D0,$F2C8

DATA_01BFB0:
	dw $FFF0,$0010

DATA_01BFB4:
	dw $0000,$0000,$FFEA,$0010

DATA_01BFBC:
	dw $0300,$30C4,$0008,$30D5,$0500,$B0C4,$0808,$B0D5
	dw $0000,$70D5,$0308,$70C4,$0800,$F0D5,$0508,$F0C4
	dw $0003,$30C4,$0005,$70C4,$0800,$F0C5,$0808,$B0C5
	dw $0000,$70C5,$0008,$30C5,$0803,$B0C4,$0805,$F0C4
	dw $03FF,$023F,$001F,$4010,$7C00,$7E00,$47E0,$03F4
	dw $03FF,$023F,$001F,$7D93,$7FFF,$7FFF,$7FFF,$7DF5
	dw $7FF7,$7FF9,$7DF5,$7FF9,$7FFF,$0000,$0000,$0000
	dw $0000,$0000,$0000,$7D93,$7FFF,$7FFF,$7EBA,$7E17
	dw $7FF7,$7F18,$7E76,$7FFB,$7FFD,$0000,$0000,$0000
	dw $0000,$0000,$0000,$7D93,$7FFF,$7FFF,$7E17,$7EBA
	dw $7FF7,$7E76,$7F18,$7FFD,$7FFB,$0000,$0000,$0000
	dw $0000,$0000,$0000,$7D93,$7FFF,$7FFF,$7DF5,$7FFF
	dw $7FF7,$7DF5,$7FF9,$7FFF,$7FF9,$0000,$0000,$0000
	dw $0000,$0000,$0000,$3B1D,$7759,$3B59

;-------------------------------------------------------------------------
; Screen-shake offset tables, applied to BG layer scroll values to
; produce earthquake / impact effects. Each is 8 word entries
; (X-shake, Y-shake) pairs. Driven by the shake-timer system that
; bosses and ground-pound effects trigger.
;-------------------------------------------------------------------------
DATA_01C098:
DATA_small_shake_offsets:                    ; Raidenthequick: DATA_small_shake_offsets
	dw $0001,$0000,$FFFF,$0000,$FFFE,$0000,$FFFF,$0000

DATA_01C0A8:
DATA_large_shake_offsets:                    ; Raidenthequick: DATA_large_shake_offsets
	dw $FFFE,$0000,$0002,$0000,$FFFE,$0000,$FFFC,$0000

DATA_01C0B8:
	dw $0707,$1717,$2727,$3737,$4747,$5757,$6767,$7777
	dw $01FF,$02FE,$2800

;-------------------------------------------------------------------------
; CODE_gm0f_core_init.
; Common entry shared by CODE_gm0f_run_level, gm0d, gm10, and gm31.
; Sets DB = Bank01, clears the four input-edge / button-state bytes
; ($35 / $36 / $37 / $38), then falls through to CODE_gm0f_run_level.
;
; INPUTS:   (none direct)
; OUTPUTS:  DB = $01; $35 = $36 = $37 = $38 = 0.
; MODIFIES: A, DB, processor flags
; CALLERS:  gm0d (CODE_gm0d_level_fadein_post_pipe_or_door), gm10 (CODE_gm10_victory_cutscene / 01E26D), and
;           gm31 (CODE_01E284).
;-------------------------------------------------------------------------
CODE_01C0CE:
CODE_gm0f_core_init:
	PHB
	PHK
	PLB
	STZ.b $36
	STZ.b $35
	STZ.b $38
	STZ.b $37
;-------------------------------------------------------------------------
; CODE_gm0f_run_level.
; See also: ys_game.asm (upstream gamemode dispatch / play loop).
; Deep dive: docs/bossengine.md section 6 (gm$0F per-frame pipeline).
; GAMEMODE $0F -- the in-level run loop. Executed every frame while
; gameplay is active. Handles message-box state, shake offsets, pause
; check, then dispatches to CODE_main_gamemode_0F.
;
; Per-frame pipeline:
;   1. $0B83 = $10 (sprite-process slot count), $0B84 = 0.
;   2. If !RAM_YI_Level_MessageBoxState != 0:
;        JSL CODE_message_box_handler_entry (message-box handler)
;        JMP CODE_01C16E (skip pause -- still goes into CODE_main_gamemode_0F).
;   3. Else if !RAM_YI_Level_CurrentPauseScreenState == 0:
;        If start-pressed edge ($38 & $10): check item-being-used,
;        Yoshi/sprite freeze, etc.; if pause permitted, toggle
;        ActivePauseScreenFlag and set CurrentPauseScreenState = 1.
;        Else JMP CODE_main_pause.
;   4. Item-being-used dispatch (DATA_01C0ED, 9-entry item table) if
;      $039C timer expired.
;   5. Falls through to CODE_main_gamemode_0F (the per-frame pipeline).
;
; INPUTS:   $35-$38 (input edges), Pause/MessageBox states.
; OUTPUTS:  May transition to pause / message-box / item-effect.
; MODIFIES: A, X, Y, DB, $0B83/$0B84.
; CALLERS:  Master gamemode dispatcher (Bank00 or Bank10 $1083E2 path).
;-------------------------------------------------------------------------
CODE_01C0D9:
CODE_gm0f_run_level:                         ; Raidenthequick: CODE_gm0f_run_level
	LDA.b #$10                          ; \ default $0B83 (sprite-process throttle?) = $10
	STA.w $0B83                         ; /
	STZ.w $0B84
	LDA.w !RAM_YI_Level_MessageBoxState 
	BEQ.b CODE_01C0FF
	JSL.l CODE_message_box_handler_entry
	JMP.w CODE_01C16E

DATA_01C0ED:
	dw CODE_ten_star_item
	dw CODE_twenty_star_item
	dw CODE_pow_block_item
	dw CODE_full_egg_item
	dw CODE_magnifying_glass_item
	dw CODE_enemies_to_cloud_item
	dw CODE_green_melon_item
	dw CODE_ice_melon_item
	dw CODE_fire_melon_item

CODE_01C0FF:
	LDA.w !RAM_YI_Level_CurrentPauseScreenState
	BNE.b CODE_01C137
	LDA.b $38
	AND.b #$10
	BEQ.b CODE_01C125
	LDA.w $7FEA
	ORA.w $0B65
	ORA.w $0B59
	ORA.w !RAM_YI_Level_ItemBeingUsed
	ORA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	ORA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	BNE.b CODE_01C125
	LDA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	CMP.b #!Define_YI_PlayerState06
	BCC.b CODE_01C128
CODE_01C125:
	JMP.w CODE_01C16E

CODE_01C128:
	LDA.w !RAM_YI_Level_ActivePauseScreenFlag
	EOR.b #$01
	AND.b #$01
	STA.w !RAM_YI_Level_ActivePauseScreenFlag
	LDA.b #$01
	STA.w !RAM_YI_Level_CurrentPauseScreenState
CODE_01C137:
	LDA.b $38
	AND.b #$20
	BEQ.b CODE_01C16B
if !Define_YI_Global_EnableDebugFeatures == !TRUE
	NOP #2
else
	BRA.b CODE_01C14B
endif

ADDR_01C13F:
	LDA.w !RAM_YI_Global_CurrentSaveFile
	CMP.b #$02
	BNE.b CODE_01C14B
	INC.w $0220
	BRA.b CODE_01C155

CODE_01C14B:
	LDX.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.w !RAM_YI_Map_LevelClearFlags,x
	AND.b #$7F
	BEQ.b CODE_01C16B
CODE_01C155:
	LDA.b #!Define_YI_MusicID_StopMusicCommand
	STA.b !RAM_YI_Global_PlayMusicLo
	LDA.b #!Define_YI_SoundID01_Unpause
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	CPX.b #!Define_YI_LevelID_WelcomeToYoshisIsland
	BNE.b CODE_01C164
	STZ.w !RAM_YI_Level_CurrentLevelFromMapLo
CODE_01C164:
	LDA.b #!Define_YI_GameMode1E
	STA.w !RAM_YI_Global_CurrentGameMode
	PLB
	RTL

CODE_01C16B:
	JMP.w CODE_main_pause

CODE_01C16E:
	LDA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_01C18B
	LDX.w $039C
	BEQ.b CODE_01C17D
	DEC.w $039C
	BRA.b CODE_01C18B

CODE_01C17D:
	ASL
	TAX
	REP.b #$20
	JSR.w (DATA_01C0ED-$02,x)
	SEP.b #$20
	BRA.b CODE_01C18B

;-------------------------------------------------------------------------
; CODE_main_gamemode_0F_l (CODE_01C188).
; Externally-callable variant: sets up DB = $01 then falls into
; CODE_main_gamemode_0F. Used by CODE_main_pause's "return to gameplay" path.
;-------------------------------------------------------------------------
CODE_01C188:
CODE_main_gamemode_0F_l:
	PHB
	PHK
	PLB
;-------------------------------------------------------------------------
; CODE_main_gamemode_0F (CODE_01C18B).
; THE PER-FRAME IN-LEVEL PIPELINE. Walks through ~15 JSL stages, each
; one of which advances a different aspect of game state. See
; docs/bossengine.md section 6.2 for the detailed call list.
;
; Critical calls for sprite/boss ticking:
;   JSL CODE_check_new_row_column (Bank10) -- per-frame level update.
;   JSL CODE_108C9A (Bank10) -- sprite spawn / despawn from
;                                  level stream (camera window).
;   JSL CODE_0397DF (Bank03) -- sprite list traversal: calls each
;                                  active sprite's Main handler. THIS
;                                  is where every boss's Main runs.
;
; Also: applies screen-shake offsets from DATA_small_shake_offsets / DATA_large_shake_offsets
; (small/large), runs per-tile-mode handler from DATA_offset_per_tile_mode_ptr
; (fuzzied / moving-platforms / unused), animation-palette dispatch
; from DATA_animation_palette_ptr (21-entry per-frame palette anim), mosaic ticking
; from DATA_01C0B8, star-timer warning logic.
;
; INPUTS:    All per-frame state (sprites, player, camera, etc.).
; OUTPUTS:   One frame of in-level gameplay advanced.
; MODIFIES:  Everything per-frame.
; CALLERS:   CODE_gm0f_run_level, CODE_01C188 (CODE_main_gamemode_0F_l).
;-------------------------------------------------------------------------
CODE_01C18B:
CODE_main_gamemode_0F:
	JSL.l CODE_init_oam_buffer
	JSL.l CODE_04FD28
	JSL.l CODE_check_new_row_column
	JSL.l CODE_108C9A
	REP.b #$20
	LDA.b !RAM_YI_Global_Layer1YPosLo
	PHA
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_01C1F8
	LDA.w $61C8
	BEQ.b CODE_01C1C7
	PHA
	LDA.w $61C6
	BEQ.b CODE_01C1B9
	DEC.w $61C6
CODE_01C1B9:
	PLA
	DEC.w $61C8
	AND.w #$0007
	ASL
	TAY
	LDA.w DATA_large_shake_offsets,y
	BRA.b CODE_01C1D7

CODE_01C1C7:
	LDA.w $61C6
	BEQ.b CODE_01C1F8
	DEC.w $61C6
	AND.w #$0007
	ASL
	TAY
	LDA.w DATA_small_shake_offsets,y
CODE_01C1D7:
	STA.w $0CB0
	CLC
	ADC.b !RAM_YI_Global_Layer1YPosLo
	STA.b !RAM_YI_Global_Layer1YPosLo
	STA.w $609C
	LDY.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	CPY.b #$09
	BEQ.b CODE_01C1ED
	CPY.b #$0A
	BNE.b CODE_01C1F8
CODE_01C1ED:
	LDA.w $0CB0
	CLC
	ADC.b !RAM_YI_Global_Layer3YPosLo
	STA.b !RAM_YI_Global_Layer3YPosLo
	STA.w $60A0
CODE_01C1F8:
	SEP.b #$20
	LDX.w $61CA
	BEQ.b CODE_01C202
	JSR.w (DATA_offset_per_tile_mode_ptr-$01,x)
CODE_01C202:
	JSL.l CODE_0394D3
	JSL.l CODE_04FA67
	JSL.l CODE_04DD9E
	JSL.l CODE_0397DF
	JSR.w CODE_hdma_per_frame_dispatch
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.b #$09
	BEQ.b CODE_01C224
	LDA.w !RAM_YI_Level_LevelHeaderAnimationPaletteLo
	ASL
	TAX
	JSR.w (DATA_animation_palette_ptr,x)
CODE_01C224:
	LDA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	BEQ.b CODE_01C232
	DEC.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	AND.b #$0F
	TAX
	LDA.w DATA_01C0B8,x
CODE_01C232:
	STA.w !RAM_YI_Global_MosaicSizeAndBGEnable
	REP.b #$20
	PLA
	STA.b !RAM_YI_Global_Layer1YPosLo
	STA.w $609C
	LDA.w $61B2
	AND.w #$A000
	STA.w $0387
	LDA.w $0C8A
	ORA.w $614E
	ORA.w $0B4C
	ORA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w $0B57
	ORA.w $0B59
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_01C260
	LDA.w #$0001
CODE_01C260:
	ORA.w $0387
	STA.w $0387
	BNE.b CODE_01C29D
	LDA.w $0389
	BEQ.b CODE_01C29D
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_MaxRegenStarTimerThreshold+$01
	LDA.w #!Define_YI_SoundID57_LoseStarsTimerAbove10
	BCS.b CODE_01C27B
	LDA.w #!Define_YI_SoundID58_LoseStarsTimerUnder10
CODE_01C27B:
	JSL.l CODE_push_sound_queue
	LDY.w !RAM_YI_Level_TutorialMessageFlagsLo
	BMI.b CODE_01C29D
	LDY.w !RAM_YI_Level_CurrentLevelFromMapLo
	BEQ.b CODE_01C28D					; Note: !Define_YI_LevelID_MakeEggsThrowEggs
	CPY.b #!Define_YI_LevelID_WelcomeToYoshisIsland
	BNE.b CODE_01C29D
CODE_01C28D:
	LDA.w #!Define_YI_TutorialMessage_BabyMarioLost
	TSB.w !RAM_YI_Level_TutorialMessageFlagsLo
	INC.w !RAM_YI_Level_MessageBoxState 
	LDA.w #$002C
	STA.l $704070
CODE_01C29D:
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_RT_00DE67
	LDA.w $0B7F
	BEQ.b CODE_01C2AE
	DEC.w $0B7F
CODE_01C2AE:
	LDA.w $0B4C
	ORA.w $0B57
	ORA.w $0B59
	BNE.b CODE_01C2E2
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_MaxRegenStarTimerThreshold
	BCC.b CODE_01C2F2
	LDA.w $0387
	BEQ.b CODE_01C2FA
	LDA.w $0B7F
	BNE.b CODE_01C2EF
	LDA.b $35
	ORA.w !EXRAM_YI_Player_CurrentStateLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_MessageBoxState 
	BNE.b CODE_01C2E2
	LDA.w $0B7D
	CMP.w #$0060
	BCS.b CODE_01C2EF
	INC.w $0B7D
	BRA.b CODE_01C2E5

CODE_01C2E2:
	STZ.w $0B7D
CODE_01C2E5:
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CPY.b #$0D
	BEQ.b CODE_01C2EF
	JMP.w CODE_01C450

CODE_01C2EF:
	JMP.w CODE_01C3C7

CODE_01C2F2:
	STZ.w $0B7D
	LDA.w $0387
	BNE.b CODE_01C2EF
CODE_01C2FA:
	LDX.b #$04
	LDA.w $7680
	SEC
	SBC.w #$0008
	CMP.w #$00E0
	BCS.b CODE_01C314
	LDA.w $7682
	SEC
	SBC.w #$0010
	CMP.w #$00C1
	BCC.b CODE_01C342
CODE_01C314:
	LDA.w $7682
	SEC
	SBC.w #$0064
	STA.b $04
	BPL.b CODE_01C323
	EOR.w #$FFFF
	INC
CODE_01C323:
	STA.b $06
	LDA.w $7680
	SEC
	SBC.w #$0078
	STA.b $00
	BPL.b CODE_01C334
	EOR.w #$FFFF
	INC
CODE_01C334:
	STA.b $02
	CMP.b $06
	BCC.b CODE_01C33C
	LDX.b #$00
CODE_01C33C:
	LDA.b $00,x
	BPL.b CODE_01C342
	INX
	INX
CODE_01C342:
	LDA.w $7680
	CLC
	ADC.w DATA_01BFB0,x
	CMP.w #$0002
	BPL.b CODE_01C351
	LDA.w #$0002
CODE_01C351:
	CMP.w #$00EF
	BMI.b CODE_01C359
	LDA.w #$00EE
CODE_01C359:
	STA.b $02
	LDA.w $7682
	CLC
	ADC.w DATA_01BFB4,x
	CMP.w #$000A
	BPL.b CODE_01C36A
	LDA.w #$000A
CODE_01C36A:
	CMP.w #$00C8
	BMI.b CODE_01C372
	LDA.w #$00C7
CODE_01C372:
	STA.b $03
	TXA
	ASL
	ASL
	ASL
	TAX
	LDA.w $7974
	AND.w #$0004
	LSR
	ADC.w #$0002
	XBA
	STA.b $00
	CLC
	LDA.b $02
	ADC.w DATA_01BFBC,x
	STA.w $6A14
	LDA.w DATA_01BFBC+$02,x
	ORA.b $00
	STA.w $6A16
	LDA.b $02
	ADC.w DATA_01BFBC+$04,x
	STA.w $6A18
	LDA.w DATA_01BFBC+$06,x
	ORA.b $00
	STA.w $6A1A
	LDA.b $02
	ADC.w DATA_01BFBC+$08,x
	STA.w $6A1C
	LDA.w DATA_01BFBC+$0A,x
	ORA.b $00
	STA.w $6A1E
	LDA.b $02
	ADC.w DATA_01BFBC+$0C,x
	STA.w $6A20
	LDA.w DATA_01BFBC+$0E,x
	ORA.b $00
	STA.w $6A22
CODE_01C3C7:
	LDA.w $03A1
	BEQ.b CODE_01C3EC
	ASL
	TAX
	LDA.w DATA_01BF72,x
	STA.w $6140
	XBA
	TAX
	INX
	INX
	STX.w $6143
	LDA.w $03A3
	ASL
	TAX
	LDA.w DATA_01BF72,x
	STA.w $6144
	XBA
	TAX
	INX
	INX
	BRA.b CODE_01C405

CODE_01C3EC:
	LDA.w $03A3
	ASL
	TAX
	LDA.w DATA_01BF5E,x
	STA.w $6140
	CLC
	ADC.w #$0020
	STA.w $6144
	XBA
	TAX
	INX
	INX
	STX.w $6143
CODE_01C405:
	STX.w $6147
	LDX.b #(FXDATA_520000+$4000)>>16
	STX.w $6142
	STX.w $6146
	LDA.w #$02AA
	STA.w $6C00
	STZ.w $6C02
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CPY.b #$0D
	BEQ.b CODE_01C437
	LDA.w $60B0
	SEC
	SBC.w #$0058
	CMP.w #$0040
	BCC.b CODE_01C43C
	LDX.b #$00
	LDA.w $60B0
	SEC
	SBC.w #$0078
	BPL.b CODE_01C439
CODE_01C437:
	LDX.b #$01
CODE_01C439:
	STX.w $0B81
CODE_01C43C:
	LDX.w $0B81
	LDY.w DATA_01BF86,x
	LDX.b #$12
CODE_01C444:
	LDA.w DATA_01BF86+$02,y
	STA.w $6A00,x
	DEY
	DEY
	DEX
	DEX
	BPL.b CODE_01C444
CODE_01C450:
	SEP.b #$20
	PLB
	RTL

DATA_01C454:
DATA_animation_palette_ptr:
	dw CODE_anim_pal_00_noop
	dw CODE_anim_pal_01_random_cycle
	dw CODE_anim_pal_02_dir_aware_cycle
	dw CODE_anim_pal_03_globalframe_cycle
	dw CODE_01C584
	dw CODE_01C5BE
	dw CODE_01C5F2
	dw CODE_01C62D
	dw CODE_01C682
	dw CODE_01C6BB
	dw CODE_01C702
	dw CODE_01C728
	dw CODE_01C783
	dw CODE_01C7F2
	dw CODE_01C84E
	dw CODE_01C897
	dw CODE_01C8CB
	dw CODE_01C906
	dw CODE_01C955
	dw CODE_01C968
	dw CODE_01C968

CODE_01C47E:
CODE_anim_pal_00_noop:                         ; animation_palette entry $00: no-op (header value 0 means "no per-frame palette animation")
	RTS

;---------------------------------------------------------------------------

DATA_01C47F:
	dw DATA_5FEB4A,DATA_5FEB64,DATA_5FEB7E,DATA_5FEB98,DATA_5FEBB2,DATA_5FEBCC,DATA_5FEBE6,DATA_5FEC00

DATA_01C48F:
	db $30,$10,$50,$10

CODE_01C493:
CODE_anim_pal_01_random_cycle:                 ; animation_palette entry $01: cycles through 8 palette rows DATA_5FEB4A..DATA_5FEC00 at intervals timed by $0B75; picks random row when cycle completes
	REP.b #$20
	DEC.w $0B75
	LDA.w $0B75
	BPL.b CODE_01C4C0
	LDA.w $0B73
	INC
	INC
	AND.w #$000E
	STA.w $0B73
	BNE.b CODE_01C4BA
	JSL.l CODE_prng
	AND.w #$0003
	TAX
	LDA.w DATA_01C48F,x
	AND.w #$00FF
	BRA.b CODE_01C4BD

CODE_01C4BA:
	LDA.w #$0004
CODE_01C4BD:
	STA.w $0B75
CODE_01C4C0:
	LDX.w $0B73
	LDA.w DATA_01C47F,x
	STA.b $00
	LDA.w #$001A
	STA.b $0E
	LDX.b #$86
	JSR.w CODE_copy_anim_palette_row
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01C4D5:
	db $00,$40,$40,$40

CODE_01C4D9:
CODE_anim_pal_02_dir_aware_cycle:              ; animation_palette entry $02: 4-row palette cycle whose speed responds to player-X-velocity (snapshot $7E12); writes both $702D76 and $70200A mirrors
	REP.b #$10
	LDA.w !EXRAM_YI_Player_XPosLo|!EXRAMBankMirror
	SEC
	SBC.w $7E12
	BMI.b CODE_01C4FB
	BNE.b CODE_01C4F8
	LDY.w $60A8
	BNE.b CODE_01C4F6
	LDX.w $0B73
	CPX.w #$0001
	BEQ.b CODE_01C4FE
	STZ.w $0B75
CODE_01C4F6:
	LDA.b #$01
CODE_01C4F8:
	EOR.b #$FF
	INC
CODE_01C4FB:
	SEC
	SBC.b #$06
CODE_01C4FE:
	SEP.b #$10
	CLC
	ADC.w $0B75
	STA.w $0B75
	BPL.b CODE_01C54C
	LDX.w $0B73
	INX
	CPX.b #$04
	BCC.b CODE_01C513
	LDX.b #$00
CODE_01C513:
	STX.w $0B73
	LDA.l DATA_01C4D5,x
	BNE.b CODE_01C524
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.b #$E0
	CLC
	ADC.b #$20
CODE_01C524:
	STA.w $0B75
	TXA
	ASL
	ADC.w $0B73
	ASL
	TAX
	PHB
	LDA.b #$70200A>>16
	PHA
	PLB
	REP.b #$20
	LDY.b #$00
CODE_01C537:
	LDA.l DATA_5FA190,x
	STA.w $702D76,y
	STA.w $70200A,y
	INX
	INX
	INY
	INY
	CPY.b #$06
	BCC.b CODE_01C537
	SEP.b #$20
	PLB
CODE_01C54C:
	RTS

;---------------------------------------------------------------------------

CODE_01C54D:
CODE_anim_pal_03_globalframe_cycle:            ; animation_palette entry $03: 4-frame cycle synced to $7974 (global animation frame); writes 16 bytes from DATA_5FCCEA into $702E4C / $7020E0 mirrors
	LDA.w $7974
	AND.b #$18
	ASL
	ASL
	ADC.b #$1E
	TAX
	PHB
	LDA.b #$7020E0>>16
	PHA
	PLB
	REP.b #$20
	LDY.b #$1E
CODE_01C560:
	LDA.l DATA_5FCCEA,x
	STA.w $702E4C,y
	STA.w $7020E0,y
CODE_01C56A:
	DEX
	DEX
	DEY
	DEY
	BPL.b CODE_01C560
	SEP.b #$20
	PLB
	RTS

;---------------------------------------------------------------------------

DATA_01C574:
	dw DATA_5FEA5A,DATA_5FEA78,DATA_5FEA96,DATA_5FEAB4,DATA_5FEAD2,DATA_5FEAF0,DATA_5FEB0E,DATA_5FEB2C

CODE_01C584:
	LDA.w $7974
	AND.b #$1C
	LSR
	TAX
	LDA.b #DATA_5FEA5A>>16
	STA.b $02
	REP.b #$20
	LDA.w $7FE4
	CLC
	ADC.w #$0000
	STA.w $7FE4
	LDA.w DATA_01C574,x
	STA.b $00
	PHB
	LDY.b #$7020E2>>16
	PHY
	PLB
	LDY.b #$00
CODE_01C5A7:
	LDA.b [$00],y
	STA.w $702E4E,y
	STA.w $7020E2,y
	INY
	INY
	CPY.b #$1E
	BCC.b CODE_01C5A7
	SEP.b #$20
	PLB
	LDA.b #$10
	STA.w $0D43
	RTS

;---------------------------------------------------------------------------

CODE_01C5BE:
	JSR.w CODE_01C644
CODE_01C5C1:
	INC.w $0B73
	LDA.w $0B73
	AND.b #$38
	ASL
	TAX
	PHB
	LDA.b #$7020E2>>16
	PHA
	PLB
	REP.b #$20
	LDY.b #$00
CODE_01C5D4:
	LDA.l DATA_5FDA00,x
	STA.w $702E4E,y
	STA.w $7020E2,y
	INX
	INX
	INY
	INY
	CPY.b #$10
	BCC.b CODE_01C5D4
	SEP.b #$20
	PLB
	RTS

;---------------------------------------------------------------------------

DATA_01C5EA:
	dw DATA_5FA150,DATA_5FA158,DATA_5FA160,DATA_5FA168

CODE_01C5F2:
	JSR.w CODE_01C5C1
	REP.b #$20
	LDA.w $7974
	AND.w #$0038
	LSR
	LSR
	TAX
	LDA.w DATA_01C634,x
	STA.b $00
	LDX.b #$86
	LDA.w #$001A
	STA.b $0E
	JSR.w CODE_copy_anim_palette_row
	SEP.b #$20
CODE_01C611:
	LDA.w $7974
	AND.b #$18
	LSR
	LSR
	TAX
	REP.b #$20
	LDA.w DATA_01C5EA,x
	STA.b $00
	LDX.b #$A6
	LDA.w #$0008
	STA.b $0E
	JSR.w CODE_copy_anim_palette_row
	SEP.b #$20
	RTS

CODE_01C62D:
	JSR.w CODE_01C5C1
	JSR.w CODE_01C5F2
	RTS

DATA_01C634:
	dw DATA_5FF5CE,DATA_5FF5F4,DATA_5FF61A,DATA_5FF640,DATA_5FF666,DATA_5FF68C,DATA_5FF6B2,DATA_5FF6D8

;---------------------------------------------------------------------------

CODE_01C644:
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	AND.b #$07
	BNE.b CODE_01C679
	REP.b #$20
	LDA.w $7974
	AND.w #$0038
	LSR
	LSR
	TAX
	LDA.w DATA_01C634,x
	STA.b $00
	LDX.b #$86
	LDA.w #$001A
	STA.b $0E
	JSR.w CODE_copy_anim_palette_row
	LDA.b $00
	CLC
	ADC.w #$001A
	STA.b $00
	LDX.b #$04
	LDA.w #$000C
	STA.b $0E
	JSR.w CODE_copy_anim_palette_row
	SEP.b #$20
CODE_01C679:
	RTS

;---------------------------------------------------------------------------

DATA_01C67A:
	dw DATA_5FA170,DATA_5FA178,DATA_5FA180,DATA_5FA188

CODE_01C682:
	LDA.w $7974
	AND.b #$0C
	LSR
	TAX
	REP.b #$20
	LDA.w DATA_01C67A,x
	STA.b $00
CODE_01C690:
	LDX.b #$A6
	LDA.w #$0008
	STA.b $0E
	JSR.w CODE_copy_anim_palette_row
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.w #$000B
	BNE.b CODE_01C6A8
	LDA.w #$0024
	STA.w $0051
CODE_01C6A8:
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01C6AB:
	dw DATA_5FC932+$00,DATA_5FC932+$02,DATA_5FC932+$04,DATA_5FC932+$06
	dw DATA_5FC932+$08,DATA_5FC932+$06,DATA_5FC932+$04,DATA_5FC932+$02

CODE_01C6BB:
	LDA.b #DATA_5FC932>>16
	STA.b $02
	LDA.w $0B75
	INC
	STA.w $0B75
	CMP.b #$06
	BCC.b CODE_01C6D7
	STZ.w $0B75
	LDA.w $0B73
	INC
	INC
	AND.b #$0E
	STA.w $0B73
CODE_01C6D7:
	LDX.w $0B73
	LDA.b #DATA_5FC932>>16
	STA.b $02
	REP.b #$20
	LDA.w DATA_01C6AB,x
	STA.b $00
	LDA.b [$00]
	STA.l $702D6E
	STA.l YI_Global_PaletteMirror[$01].LowByte
	STA.l $702D7E
	STA.l YI_Global_PaletteMirror[$09].LowByte
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01C6FA:
	dw DATA_5FE2EC,DATA_5FE2F4,DATA_5FE2FC,DATA_5FE304

CODE_01C702:
	LDA.w $7974
	AND.b #$18
	LSR
	LSR
	TAX
	LDA.b #DATA_5FE2EC>>16
	STA.b $02
	REP.b #$20
	LDA.w DATA_01C6FA,x
	STA.b $00
	JMP.w CODE_01C690

;---------------------------------------------------------------------------

DATA_01C718:
	dw DATA_5FE336,DATA_5FE330,DATA_5FE32A,DATA_5FE324,DATA_5FE31E,DATA_5FE318,DATA_5FE312,DATA_5FE30C

CODE_01C728:
	REP.b #$20
	LDA.w $0B75
	INC
	CMP.w #$0070
	BCS.b CODE_01C738
	STA.w $0B75
	BRA.b CODE_01C770

CODE_01C738:
	LDA.w $7974
	AND.w #$007F
	BNE.b CODE_01C770
	SEP.b #$20
	LDA.b #$04
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$13
	STA.w !RAM_YI_Global_SubScreenLayers
	LDA.b #$24
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	REP.b #$20
	LDA.w $0B73
	INC
	CMP.w #$0008
	BCS.b CODE_01C770
	STA.w $0B73
	ASL
	TAY
	LDA.w DATA_01C718,y
	STA.b $00
	LDX.b #$02
	LDA.w #$0006
	STA.b $0E
	JSR.w CODE_copy_anim_palette_row
CODE_01C770:
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01C773:
	dw DATA_5FE30C,DATA_5FE312,DATA_5FE318,DATA_5FE31E,DATA_5FE324,DATA_5FE32A,DATA_5FE330,DATA_5FE336

CODE_01C783:
	REP.b #$20
	LDA.w $0B75
	INC
	CMP.w #$01A0
	BCS.b CODE_01C793
	STA.w $0B75
	BRA.b CODE_01C7CF

CODE_01C793:
	LDA.w $7974
	AND.w #$003F
	BNE.b CODE_01C770
	LDA.w $0B73
	INC
	CMP.w #$0008
	BCS.b CODE_01C7BA
	STA.w $0B73
	ASL
	TAY
	LDA.w DATA_01C773,y
	STA.b $00
	LDX.b #$02
	LDA.w #$0006
	STA.b $0E
	JSR.w CODE_copy_anim_palette_row
	BRA.b CODE_01C7CF

CODE_01C7BA:
	LDA.w !RAM_YI_Global_MainScreenLayers
	EOR.w #$0004
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w !RAM_YI_Global_ColorMathSelectAndEnable
	EOR.w #$0004
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	STZ.w !RAM_YI_Level_LevelHeaderAnimationPaletteLo
CODE_01C7CF:
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01C7D2:
	dw DATA_5FEC1A,DATA_5FEC20,DATA_5FEC26,DATA_5FEC2C,DATA_5FEC2C,DATA_5FEC26,DATA_5FEC20,DATA_5FEC1A

DATA_01C7E2:
	dw DATA_5FEC32,DATA_5FEC38,DATA_5FEC3E,DATA_5FEC44,DATA_5FEC44,DATA_5FEC3E,DATA_5FEC38,DATA_5FEC32

CODE_01C7F2:
	LDA.w $0B75
	INC
	CMP.b #$0C
	BCC.b CODE_01C7FF
	INC.w $0B73
	LDA.b #$00
CODE_01C7FF:
	STA.w $0B75
	LDA.w $0B73
	AND.b #$07
	ASL
	TAY
	REP.b #$20
	LDA.w !RAM_YI_Level_LevelHeaderBG3PaletteLo
	AND.w #$0001
	BNE.b CODE_01C818
	LDA.w DATA_01C7D2,y
	BRA.b CODE_01C81B

CODE_01C818:
	LDA.w DATA_01C7E2,y
CODE_01C81B:
	STA.b $00
	LDX.b #$02
	LDA.w #$0006
	STA.b $0E
	JSR.w CODE_copy_anim_palette_row
	LDA.w #$0002
	STA.w $0D43
	LDA.w #$0002
	STA.w $0D4B
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01C836:
	dw DATA_5FF76E,DATA_5FF78E,DATA_5FF7AE,DATA_5FF7CE,DATA_5FF7EE,DATA_5FF80E,DATA_5FF82E,DATA_5FF84E

DATA_01C846:
	dw $00D0,$00C8

DATA_01C84A:
	dw $001C,$0038

CODE_01C84E:
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.b #$08
	BNE.b CODE_01C85A
	JSR.w CODE_01C702
	BRA.b CODE_01C85D

CODE_01C85A:
	JSR.w CODE_01C611
CODE_01C85D:
	REP.b #$20
	LDA.w !RAM_YI_Level_LevelHeaderBG2PaletteLo
	AND.w #$0001
	ASL
	TAY
	ASL
	ASL
	ASL
	STA.b $00
	LDA.w DATA_01C846,y
	TAX
	LDA.w DATA_01C84A,y
	AND.w $7974
	DEY
	BMI.b CODE_01C87A
	LSR
CODE_01C87A:
	LSR
	TAY
	LDA.w DATA_01C836,y
	CLC
	ADC.b $00
	STA.b $00
	LDA.w #$0010
	STA.b $0E
	JSR.w CODE_copy_anim_palette_row
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01C88F:
	dw DATA_5FF46A,DATA_5FF470,DATA_5FF476,DATA_5FF47C

CODE_01C897:
	REP.b #$20
	LDA.w $7974
	AND.w #$000C
	LSR
	TAX
	LDA.w DATA_01C88F,x
	STA.b $00
	LDA.w #$0006
	STA.b $0E
	LDX.b #$0A
	JSR.w CODE_copy_anim_palette_row
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01C8B3:
	dw DATA_5FF760,DATA_5FF752,DATA_5FF744,DATA_5FF736,DATA_5FF728,DATA_5FF71A,DATA_5FF70C,DATA_5FF6FE

DATA_01C8C3:
	dw $00C0,$00A0,$00E0,$00A0

CODE_01C8CB:
	REP.b #$20
	LDA.w $0B77
	CMP.w #$0080
	BCS.b CODE_01C8EA
	LSR
	LSR
	AND.w #$000E
	TAX
	LDA.w DATA_01C8B3,x
	STA.b $00
	LDA.w #$000E
	STA.b $0E
	LDX.b #$92
	JSR.w CODE_copy_anim_palette_row
CODE_01C8EA:
	DEC.w $0B77
	BPL.b CODE_01C900
	JSL.l CODE_prng
	ADC.b $30
	AND.w #$0003
	ASL
	TAX
	LDA.w DATA_01C8C3,x
	STA.w $0B77
CODE_01C900:
	SEP.b #$20
	JSR.w CODE_01C5C1
	RTS

;---------------------------------------------------------------------------

CODE_01C906:
	JSR.w CODE_01C84E
	REP.b #$20
	LDA.w #DATA_5FF95E
	STA.b $00
	SEP.b #$20
CODE_01C912:
	REP.b #$20
	LDA.w $0B79
	CMP.w #$0320
	BCC.b CODE_01C946
	CMP.w #$0520
	BCS.b CODE_01C952
	SBC.w #$031F
	AND.w #$FFE0
	LSR
	LSR
	ADC.b $00
	STA.b $00
	LDA.w #$0008
	STA.b $0E
	LDX.b #$00
	JSR.w CODE_copy_anim_palette_row
	LDA.w #$1304
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w !RAM_YI_Global_ColorMathSelectAndEnable
	ORA.w #$0004
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
CODE_01C946:
	CLC
	SED
	LDA.w $0B79
	ADC.w #$0001
	STA.w $0B79
	CLD
CODE_01C952:
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

CODE_01C955:
	JSR.w CODE_01C702
	JSR.w CODE_01C8CB
	REP.b #$20
	LDA.w #DATA_5FF9DE
	STA.b $00
	SEP.b #$20
	JSR.w CODE_01C912
	RTS

;---------------------------------------------------------------------------

CODE_01C968:
	JSR.w CODE_anim_pal_02_dir_aware_cycle
	JSR.w CODE_01C85D
	REP.b #$20
	LDA.w $7974
	AND.w #$0038
	LSR
	LSR
	TAX
	LDA.w DATA_01C634,x
	STA.b $00
	LDX.b #$86
	LDA.w #$001A
	STA.b $0E
	JSR.w CODE_copy_anim_palette_row
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

CODE_01C98B:
	REP.b #$20
	LDA.w $0B79
	CMP.w #$0320
	BCC.b CODE_01C9C0
	CMP.w #$0520
	BCS.b CODE_01C9CC
	SBC.w #$031F
	AND.w #$FFE0
	LSR
	LSR
	ADC.w #DATA_5FF9DE
	STA.b $00
	LDA.w #$0008
	STA.b $0E
	LDX.b #$00
	JSR.w CODE_copy_anim_palette_row
	LDA.w #$1304
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.w !RAM_YI_Global_ColorMathSelectAndEnable
	ORA.w #$0004
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
CODE_01C9C0:
	CLC
	SED
	LDA.w $0B79
	ADC.w #$0001
	STA.w $0B79
	CLD
CODE_01C9CC:
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

CODE_01C9CF:
CODE_copy_anim_palette_row:                    ; shared helper for animation_palette handlers: copy $0E bytes from [$00..02] into BOTH CGRAM mirrors at $702000 and $702D6C starting at byte-offset X (CGRAM word*2)
	LDA.w #DATA_5FE2EC>>16
	STA.b $02
	PHB
	LDY.b #$702000>>16
	PHY
	PLB
	LDY.b #$00
CODE_01C9DB:
	LDA.b [$00],y
	STA.w $702D6C,x
	STA.w $702000,x
	INX
	INX
	INY
	INY
	CPY.b $0E
	BCC.b CODE_01C9DB
	PLB
	RTS

;---------------------------------------------------------------------------

DATA_01C9ED:
	dw $142A,$30E0,$143A,$30E2,$242A,$3100,$243A,$3102
	dw $1446,$30E4,$1456,$30E6,$2446,$3104,$2456,$3106
	dw $1462,$30E8,$1472,$30EA,$2462,$3108,$2472,$310A
	dw $147E,$30EC,$148E,$30EE,$247E,$310C,$248E,$310E
	dw $149A,$3120,$14AA,$3122,$249A,$3128,$24AA,$312A

DATA_01CA3D:
DATA_pause_init_timer:
	db $00,$04,$08,$0C,$10

DATA_01CA42:
DATA_pause_letter_delta_size:
	db $FC,$04,$FC,$04,$FC,$04,$FC,$04
	db $FC,$04,$FC,$01,$00

DATA_01CA4F:
DATA_pause_letter_final_size:
	db $20,$34

DATA_01CA51:
	db $20,$34

DATA_01CA53:
	db $20,$34,$20,$34,$20,$34,$20,$34
	db $00,$04,$FF,$40,$10

DATA_01CA60:
	db $00,$01,$02,$03,$04

DATA_01CA65:
	db $10,$30,$50,$70,$10

DATA_01CA6A:
	db $50,$50,$50,$50,$70

DATA_01CA6F:
DATA_pause_sounds:
	dw !Define_YI_SoundID01_Unpause,!Define_YI_SoundID02_Pause

DATA_01CA73:
DATA_pause_state_ptrs:
	dw CODE_pause_fade_level
	dw CODE_pause_level_init
	dw CODE_pause_play_sfx
	dw CODE_pause_init_letters
	dw CODE_pause_preserve_bg3_gfx_2
	dw CODE_pause_preserve_bg3_tilemap
	dw CODE_pause_upload_sprite_gfx
	dw CODE_pause_load_gfx
	dw CODE_pause_handle_reg_mirrors
	dw CODE_pause_load_tilemap
	dw CODE_pause_reverse_fade
	dw CODE_pause_fade_letters
	dw CODE_pause_fade_letters
	dw CODE_pause_fade_letters
	dw CODE_pause_fade_letters
	dw CODE_pause_fade_letters
	dw CODE_pause_fade_letters
	dw CODE_pause_fade_letters
	dw CODE_pause_main
	dw CODE_pause_leave

;-------------------------------------------------------------------------
; CODE_main_pause.
; The PAUSE-screen state machine. Dispatched per-frame while
; !RAM_YI_Level_CurrentPauseScreenState != 0.
;
; State byte: !RAM_YI_Level_CurrentPauseScreenState (1..20).
; Active flag:  !RAM_YI_Level_ActivePauseScreenFlag (0 = entering,
;               1 = leaving; passed to handlers as Y).
;
; Dispatches via DATA_pause_state_ptrs (20 entries):
;   $01 CODE_pause_fade_level         -- fade BG to dimmed pause
;   $02 CODE_pause_level_init         -- snapshot level state, prep pause RAM
;   $03 CODE_pause_play_sfx           -- play pause/unpause SFX
;   $04 CODE_pause_init_letters       -- animate the "PAUSE" letters
;   $05 CODE_pause_preserve_bg3_gfx_2 -- snapshot BG3 graphics
;   $06 CODE_pause_preserve_bg3_tilemap -- snapshot BG3 tilemap
;   $07 CODE_pause_upload_sprite_gfx  -- upload pause sprite-gfx
;   $08 CODE_pause_load_gfx           -- decompress pause backdrop
;   $09 CODE_pause_handle_reg_mirrors -- snapshot/restore PPU/HDMA regs
;   $0A CODE_pause_load_tilemap       -- generate pause tilemap
;   $0B CODE_pause_reverse_fade       -- reverse pause-fade
;   $0C-$12 CODE_pause_fade_letters   -- 7 sub-steps of letter-fade-in
;   $13 CODE_pause_main               -- IDLE PAUSE: poll item menu, item-
;                                   selection, fly-letter animation
;   $14 CODE_pause_leave              -- close pause, restore everything
;
; INPUTS:   Current/Active pause state.
; OUTPUTS:  Pause progresses one step; on exit, returns to in-level loop.
; MODIFIES: A, X, Y, palette, VRAM, OAM (saved/restored).
; CALLERS:  CODE_01C16B (in CODE_gm0f_run_level when pause active).
;-------------------------------------------------------------------------
CODE_01CA9B:
CODE_main_pause:
	REP.b #$30
	LDA.w !RAM_YI_Level_CurrentPauseScreenState
	AND.w #$00FF
	ASL
	TAX
	LDA.w !RAM_YI_Level_ActivePauseScreenFlag
	AND.w #$00FF
	ASL
	TAY
	JSR.w (DATA_pause_state_ptrs-$02,x)
	SEP.b #$30
	LDA.w !RAM_YI_Level_CurrentPauseScreenState
	CMP.b #$0B
	BCC.b CODE_01CAC4
	LDA.w $0CF6
	BEQ.b CODE_01CAC4
	JSR.w CODE_01DE0A
	JSR.w CODE_01CAD6
CODE_01CAC4:
	PLB
	RTL

DATA_01CAC6:
	dw $7C00,$7C1F,$001F,$03FF,$03E0,$03FF,$001F,$7C1F

CODE_01CAD6:
	REP.b #$20
	LDA.b $30
	AND.w #$0038
	LSR
	LSR
	TAX
	LDA.w DATA_01CAC6,x
	STA.l YI_Global_PaletteMirror[$1E].LowByte
	SEP.b #$20
	RTS

DATA_01CAEA:
DATA_pause_fade_ptrs:
	dw CODE_pause_fade_step_in
	dw CODE_pause_fade_step_out

;-------------------------------------------------------------------------
; CODE_pause_reverse_fade -- pause state $0B. XORs flag, falls
; into CODE_pause_fade_level path.
;-------------------------------------------------------------------------
CODE_01CAEE:
CODE_pause_reverse_fade:
	SEP.b #$30
	LDA.w !RAM_YI_Level_ActivePauseScreenFlag
	EOR.b #$01
	BRA.b CODE_01CAFC

;-------------------------------------------------------------------------
; CODE_pause_fade_level -- pause state $01. Fades the
; brightness via $0200 ($2100 INIDISP mirror). Reads ActivePauseScreen-
; Flag to pick fade-direction; dispatches via DATA_pause_fade_ptrs:
;   Y=0 CODE_pause_fade_step_in -- fade IN (BCB up by 2)
;   Y=1 CODE_pause_fade_step_out -- fade OUT (DEC by 2)
; When brightness saturated (full 15 or off), jumps to CODE_01C2E2
; (gm0f tail) to skip the rest of CODE_main_gamemode_0F this frame.
;-------------------------------------------------------------------------
CODE_01CAF7:
CODE_pause_fade_level:
	SEP.b #$30
	LDA.w !RAM_YI_Level_ActivePauseScreenFlag
CODE_01CAFC:
	PHA
	ASL
	TAX
	LDA.w $0200
	JSR.w (DATA_pause_fade_ptrs,x)
	PLA
	EOR.w !RAM_YI_Level_ActivePauseScreenFlag
	BEQ.b CODE_01CB0C
	RTS

CODE_01CB0C:
	REP.b #$20
	PLA
	JML.l CODE_01C2E2

CODE_01CB13:
CODE_pause_fade_step_out:                      ; pause fade-out helper: decrement brightness by 2; on underflow advance pause state and set INIDISP force-blank ($80)
	DEC
	DEC
	BPL.b CODE_01CB2B
	JSR.w CODE_pause_next_state
	LDA.b #$80
	BRA.b CODE_01CB2B

CODE_01CB1E:
CODE_pause_fade_step_in:                       ; pause fade-in helper: increment brightness by 2; on saturating $0F advance pause state and clamp
	AND.b #$0F
	INC
	INC
	CMP.b #$0F
	BCC.b CODE_01CB2B
	JSR.w CODE_pause_next_state
	LDA.b #$0F
CODE_01CB2B:
	STA.w $0200
	RTS

;-------------------------------------------------------------------------
; CODE_pause_level_init -- pause state $02. JSL CODE_init_oam
; (BRR upload), on first entry zeros $093C / $093E / $0940 / $0942
; (level-progress bytes) and runs JSL CODE_01C188 (calls
; CODE_main_gamemode_0F_l one more time to flush state). Calls
; CODE_pause_next_state to advance pause state.
;-------------------------------------------------------------------------
CODE_01CB2F:
CODE_pause_level_init:
	SEP.b #$30
	JSL.l CODE_init_oam
	REP.b #$30
	LDA.w !RAM_YI_Level_ActivePauseScreenFlag
	BNE.b CODE_01CB54
	STZ.w $093C
	STZ.w $093E
	STZ.w $0940
	STZ.w $0942
	STZ.b $35
	STZ.b $37
	SEP.b #$30
	JSL.l CODE_01C188
	REP.b #$30
CODE_01CB54:
	JSR.w CODE_pause_next_state
	RTS

DATA_01CB58:
DATA_pause_dma_spr_vram:
	dw $5400,$D400

DATA_01CB5C:
DATA_pause_dma_spr_size:
	dw $1000,$1002

;-------------------------------------------------------------------------
; CODE_pause_play_sfx -- pause state $03. Plays pause sound
; from DATA_pause_sounds[Y] ($01 unpause / $02 pause), then DMA-uploads
; OAM-snapshot data to $7E:7BBE (via shared CODE_pause_do_vram_dma helper).
;-------------------------------------------------------------------------
CODE_01CB60:
CODE_pause_play_sfx:
	TYX
	LDA.w DATA_pause_sounds,x
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	LDA.w #$7E7BBE
	STA.b $00
	LDY.w DATA_pause_dma_spr_size,x
	LDA.w DATA_pause_dma_spr_vram,x
	JMP.w CODE_pause_do_vram_dma

DATA_01CB74:
DATA_pause_dma_bg3_gfx_vram_1:
	dw $4E00,$CE00

DATA_01CB78:
DATA_pause_dma_bg3_gfx_size:
	dw $0C00,$0C02

CODE_01CB7C:
CODE_pause_init_letters:
	SEP.b #$30
	LDX.b #$35
CODE_01CB80:
	STZ.w $0B12,x
	DEX
	BPL.b CODE_01CB80
	LDX.b #$04
CODE_01CB88:
	LDA.w DATA_pause_init_timer,x
	STA.w $0B42,x
	DEX
	BPL.b CODE_01CB88
	REP.b #$30
	TYX
	LDA.w #$7E7BBE
	CLC
	ADC.w DATA_pause_dma_spr_size+$02
	STA.b $00
	LDY.w DATA_pause_dma_bg3_gfx_size,x
	LDA.w DATA_pause_dma_bg3_gfx_vram_1,x
	BRA.b CODE_pause_do_vram_dma

DATA_01CBA5:
DATA_pause_dma_bg3_gfx_vram_2:
	dw $2800,$A800

CODE_01CBA9:
CODE_pause_preserve_bg3_gfx_2:
	TYX
	LDA.w #$7E97C4
	STA.b $00
	LDY.w DATA_pause_dma_spr_size,x
	LDA.w DATA_pause_dma_bg3_gfx_vram_2,x
	BRA.b CODE_pause_do_vram_dma

DATA_01CBB7:
DATA_pause_dma_bg3_tm_vram:
	dw $3400,$B400

DATA_01CBBB:
DATA_pause_dma_bg3_tm_size:
	dw $0800,$0802

CODE_01CBBF:
CODE_pause_preserve_bg3_tilemap:
	TYX
	LDA.w #$7EA7C6
	STA.b $00
	LDY.w DATA_pause_dma_bg3_tm_size,x
	LDA.w DATA_pause_dma_bg3_tm_vram,x
CODE_01CBCB:
CODE_pause_do_vram_dma:
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	LDX.w $7E4800
	STA.w $0000,x
	ASL
	LDA.w #$0080
	STA.w $0002,x
	LDA.w #$7E7BBE>>16
	STA.w $0007,x
	TYA
	STA.w $0008,x
	LDA.w #((!REGISTER_ReadFromVRAMPortLo&$0000FF)<<8)+$81
	LDY.b $00
	BCS.b CODE_01CBF4
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	INY
	INY
CODE_01CBF4:
	STA.w $0003,x
	TYA
	STA.w $0005,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	STA.w $7E4800
	PLB
	JSR.w CODE_pause_next_state
	RTS

CODE_01CC0B:
CODE_pause_upload_sprite_gfx:
	TYA
	BEQ.b CODE_01CC2B
	LDX.w #DATA_568000+$6800
	LDA.w #DATA_568000+$6800>>16
	LDY.w !RAM_YI_Level_CantUseItemsFlagLo
	BEQ.b CODE_01CC1F
	LDX.w #FXDATA_520000+$B000
	LDA.w #FXDATA_520000+$B000>>16
CODE_01CC1F:
	STA.b $01
	LDY.w #$5400
	LDA.w #$0400
	JSL.l CODE_vram_dma_queue_add_180_2118
CODE_01CC2B:
	JSR.w CODE_pause_next_state
	RTS

CODE_01CC2F:
CODE_pause_load_gfx:
	TYA
	BEQ.b CODE_01CC48
	LDA.w #$004F
	JSL.l CODE_00B753
	LDX.w #$706800>>16
	STX.b $01
	LDX.w #$706800
	LDY.w #$2C00
	JSL.l CODE_vram_dma_queue_add_180_2118
CODE_01CC48:
	JSR.w CODE_pause_next_state
	RTS

DATA_01CC4C:
DATA_pause_reg_backup_bank:
	dw $7EAFC8>>16,$00095E>>16,$7EAFC8>>16

DATA_01CC52:
DATA_pause_reg_backup_addr:
	dw $7EAFC8,$00095E,$7EAFC8

DATA_01CC58:
DATA_pause_write_reg_ptrs:
	dw CODE_pause_restore_regs
	dw CODE_pause_backup_regs

CODE_01CC5C:
CODE_pause_handle_reg_mirrors:
	JSR.w CODE_pause_next_state
	TYX
	JSR.w (DATA_pause_write_reg_ptrs,x)
	LDA.w DATA_pause_reg_backup_bank,y
	STA.b $02
	LDA.w DATA_pause_reg_backup_addr,y
	STA.b $00
	INY
	INY
	LDA.w DATA_pause_reg_backup_bank,y
	STA.b $05
	LDA.w DATA_pause_reg_backup_addr,y
	STA.b $03
	LDY.w #$0000
	TYX
	SEP.b #$20
CODE_01CC7F:
	LDA.b [$00],y
	STA.b [$03],y
	INY
	CPY.w #$000E
	BCC.b CODE_01CC7F
	RTS

DATA_01CC8A:
DATA_pause_tilemap_actions:
	dw CODE_pause_restore_palette
	dw CODE_pause_generate_tilemap

CODE_01CC8E:
CODE_pause_load_tilemap:
	JSR.w CODE_pause_next_state
	PHB
	SEP.b #$10
	TYX
	JMP.w (DATA_pause_tilemap_actions,x)

CODE_01CC98:
CODE_pause_fade_letters:
	JSR.w CODE_pause_next_state
	SEP.b #$30
	LDA.w !RAM_YI_Level_CurrentPauseScreenState
	SEC
	SBC.b #$0C
	ASL
	ASL
	ASL
	LDX.b #$04
CODE_01CCA8:
	STA.w $0B36,x
	DEX
	BPL.b CODE_01CCA8
	JMP.w CODE_pause_render_letters

;-------------------------------------------------------------------------
; CODE_pause_main -- pause state $13 (the IDLE pause loop).
; Calls CODE_pause_handle_item_menu if any items, polls inputs for start/
; select to leave pause, then runs CODE_pause_letters (the "PAUSE" letter
; animation) and CODE_pause_render_letters (SuperFX-driven OAM build for the
; floating letters).
;-------------------------------------------------------------------------
CODE_01CCB1:
CODE_pause_main:
	SEP.b #$30
	LDA.w !RAM_YI_Level_PauseMenuItemInventory
	BEQ.b CODE_01CCBB
	JSR.w CODE_pause_handle_item_menu
CODE_01CCBB:
	LDA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_01CCC6
	LDA.b $37
	AND.b #$80
	BNE.b CODE_01CCCC
CODE_01CCC6:
	ORA.b $38
	AND.b #$90
	BEQ.b CODE_pause_letters
CODE_01CCCC:
	JSR.w CODE_pause_next_state
CODE_01CCCF:
CODE_pause_letters:
	LDX.b #$04
CODE_01CCD1:
	LDA.w $0B42,x
	BEQ.b CODE_01CCE1
	LDA.b $30
	AND.b #$03
	BNE.b CODE_01CD50
	DEC.w $0B42,x
	BRA.b CODE_01CD50

CODE_01CCE1:
	LDY.w $0B3C,x
	LDA.b $30
	AND.b #$03
	BNE.b CODE_01CCFC
	LDA.w $0B36,x
	CLC
	ADC.w DATA_pause_letter_delta_size,y
	STA.w $0B36,x
	CMP.w DATA_pause_letter_final_size,y
	BNE.b CODE_01CCFC
	INC.w $0B3C,x
CODE_01CCFC:
	CPY.b #$0B
	BCC.b CODE_01CD50
	LDA.w $0B1E,x
	CMP.w DATA_01CA53,y
	BNE.b CODE_01CD21
	CPY.b #$0B
	BEQ.b CODE_01CD30
	LDA.w $0B12,x
	BNE.b CODE_01CD30
	STZ.w $0B3C,x
	STZ.w $0B1E,x
	STZ.w $0B2A,x
	LDA.b #$20
	STA.w $0B42,x
	BRA.b CODE_pause_render_letters

CODE_01CD21:
	LDA.b $30
	LSR
	BCS.b CODE_01CD30
	LDA.w $0B1E,x
	CLC
	ADC.w DATA_01CA51,y
	STA.w $0B1E,x
CODE_01CD30:
	LDA.w $0B1E,x
	TAY
	ASL
	ASL
	ASL
	ASL
	CLC
	ADC.w $0B2A,x
	STA.w $0B2A,x
	TYA
	PHP
	LSR
	LSR
	LSR
	LSR
	PLP
	BPL.b CODE_01CD4A
	ORA.b #$F0
CODE_01CD4A:
	ADC.w $0B12,x
	STA.w $0B12,x
CODE_01CD50:
	DEX
	BMI.b CODE_pause_render_letters
	JMP.w CODE_01CCD1

CODE_01CD56:
CODE_pause_render_letters:
	REP.b #$20
	LDA.w #$6800
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$0800
	STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
	LDX.b #FXCODE_08D2F1>>16
	LDA.w #FXCODE_08D2F1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b #$04
CODE_01CD6F:
	LDA.w DATA_01CA60,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $0B12,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w DATA_01CA65,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w DATA_01CA6A,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $0B36,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	PHX
	LDX.b #FXCODE_08F165>>16
	LDA.w #FXCODE_08F165
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	DEX
	BPL.b CODE_01CD6F
	LDA.w #$7400
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$7100
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0080
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0001
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_08D2FB>>16
	LDA.w #FXCODE_08D2FB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$7600
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w #$7300
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #$0080
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0001
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDX.b #FXCODE_08D2FB>>16
	LDA.w #FXCODE_08D2FB
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$AAAA
	STA.l $006C00
	STA.l $006C02
	STA.l $006C04
	STA.l $006C06
	SEP.b #$20
	STZ.b $00
	LDA.b #$10
	STA.b $00
	LDX.b #$00
CODE_01CE0C:
	LDA.w DATA_01C9ED,x
	CLC
	ADC.b $00
	STA.l $006A00,x
	LDA.w DATA_01C9ED+$01,x
	STA.l $006A01,x
	LDA.w DATA_01C9ED+$02,x
	STA.l $006A02,x
	LDA.w DATA_01C9ED+$03,x
	STA.l $006A03,x
	INX
	INX
	INX
	INX
	CPX.b #$50
	BCC.b CODE_01CE0C
	RTS

;-------------------------------------------------------------------------
; CODE_pause_leave -- pause state $14 (exiting). If an item is
; being used, runs item-use anim counter $0B11 0..$20 (3-frame cycle).
; Toggles ActivePauseScreenFlag, twice calls CODE_pause_next_state (advance pause
; state) -- so the pause state machine fully unwinds and returns to
; gameplay.
;-------------------------------------------------------------------------
CODE_01CE34:
CODE_pause_leave:
	SEP.b #$30
	LDA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_01CE48
	INC.w $0B11
	LDA.w $0B11
	CMP.b #$20
	BCC.b CODE_01CE58
	STZ.w $0B11
CODE_01CE48:
	LDA.w !RAM_YI_Level_ActivePauseScreenFlag
	EOR.b #$01
	AND.b #$01
	STA.w !RAM_YI_Level_ActivePauseScreenFlag
	JSR.w CODE_pause_next_state
	JSR.w CODE_pause_next_state
CODE_01CE58:
	JMP.w CODE_pause_render_letters

DATA_01CE5B:
DATA_pause_delta_state:
	db $FF,$01

;-------------------------------------------------------------------------
; CODE_pause_next_state. Shared pause-state-machine advance.
; Reads ActivePauseScreenFlag to decide direction (DATA_pause_delta_state: $FF
; opening / $01 closing), updates !RAM_YI_Level_CurrentPauseScreenState
; accordingly. If state wraps to 0 AND an item is being used, plays
; "collect-super-star" sound + sets item-effect timer $039C = $40.
;-------------------------------------------------------------------------
CODE_01CE5D:
CODE_pause_next_state:
	PHY
	PHP
	SEP.b #$20
	LDY.w !RAM_YI_Level_ActivePauseScreenFlag
	LDA.w !RAM_YI_Level_CurrentPauseScreenState
	CLC
	ADC.w DATA_pause_delta_state,y
	STA.w !RAM_YI_Level_CurrentPauseScreenState
	BNE.b CODE_01CE80
	LDA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_01CE80
	LDA.b #!Define_YI_SoundID27_CollectSuperStar
	JSL.l CODE_push_sound_queue
	LDA.b #$40
	STA.w $039C
CODE_01CE80:
	PLP
	PLY
	RTS

CODE_01CE83:
CODE_pause_restore_regs:
	LDA.l $7EAFD7
	STA.b !RAM_YI_Global_Layer3XPosLo
	LDA.l $7EAFD9
	STA.b !RAM_YI_Global_Layer3YPosLo
	LDA.l $7EAFDB
	STA.w !RAM_YI_Global_HDMAEnable
	LDA.l $7EAFDD
	STA.w $0948
	SEP.b #$20
	LDA.l $7EB6DF
	STA.w $011C
	LDA.l $7EB8E0
	STA.w !RAM_YI_Global_MosaicSizeAndBGEnable
	LDA.l $7EB8E1
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	REP.b #$20
	RTS

CODE_01CEB7:
CODE_pause_backup_regs:
	LDA.b !RAM_YI_Global_Layer3XPosLo
	STA.l $7EAFD7
	LDA.b !RAM_YI_Global_Layer3YPosLo
	STA.l $7EAFD9
	LDA.w !RAM_YI_Global_HDMAEnable
	STA.l $7EAFDB
	LDA.w $0948
	STA.l $7EAFDD
	SEP.b #$20
	LDA.w $011C
	STA.l $7EB6DF
	LDA.w !RAM_YI_Global_MosaicSizeAndBGEnable
	STA.l $7EB8E0
	STZ.w !RAM_YI_Global_MosaicSizeAndBGEnable
	LDA.w !RAM_YI_Global_ColorMathSelectAndEnable
	STA.l $7EB8E1
	LDA.b #$20
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	REP.b #$20
	PHY
	LDA.w #DATA_568000+$5000>>16
	STA.b $01
	LDY.w #$2800
	LDX.w #DATA_568000+$5000
	LDA.w #$0800
	JSL.l CODE_vram_dma_queue_add_180_2118
	PLY
	RTS

CODE_01CF07:
CODE_pause_restore_palette:
	LDX.b #$00
CODE_01CF09:
	LDA.l $7EB6E0,x
	STA.l YI_Global_PaletteMirror[$00].LowByte,x
	LDA.l $7EB7E0,x
	STA.l YI_Global_PaletteMirror[$80].LowByte,x
	INX
	INX
	BNE.b CODE_01CF09
	PLB
	RTS

CODE_01CF1F:
CODE_pause_generate_tilemap:
	LDA.w #$0000
	STA.b !RAM_YI_Global_Layer3XPosLo
	STA.b !RAM_YI_Global_Layer3YPosLo
	STA.w $0948
	TAX
	STX.w !RAM_YI_Global_HDMAEnable
	LDY.b #$702000>>16
	PHY
	PLB
CODE_01CF31:
	LDA.w $702000,x
	STA.l $7EB6E0,x
	LDA.w $702100,x
	STA.l $7EB7E0,x
	INX
	INX
	BNE.b CODE_01CF31
	LDA.w #$0000
	TAX
	TXY
CODE_01CF48:
	STA.w $702000,x
	STA.w $702100,x
	INX
	INX
	BNE.b CODE_01CF48
	TYX
CODE_01CF53:
	LDA.l DATA_5FA002,x
	STA.w $702002,x
	LDA.l DATA_5FA022,x
	STA.w $702022,x
	LDA.l DATA_5FA1C8,x
	STA.w $702102,x
	LDA.l DATA_5FA1E6,x
	STA.w $702122,x
	LDA.l DATA_5FA204,x
	STA.w $702142,x
	INX
	INX
	CPX.b #$1E
	BCC.b CODE_01CF53
	LDX.b #$7EAFDF>>16
	PHX
	PLB
	LDX.b #$00
	LDA.w #$217F
CODE_01CF85:
	STA.w $7EAFDF,x
	STA.w $7EB0DF,x
	STA.w $7EB1DF,x
	STA.w $7EB2DF,x
	STA.w $7EB3DF,x
	STA.w $7EB4DF,x
	STA.w $7EB5DF,x
	INX
	INX
	BNE.b CODE_01CF85
	LDX.b #$00
	STX.b $00
	TXY
CODE_01CFA3:
	LDA.b $00
	ASL
	TAX
	LDA.l DATA_01B689,x
	STA.w $7EB3E7,y
	LDX.b $00
	CPX.b #$15
	BCS.b CODE_01CFCA
	LDA.l DATA_01B835,x
	AND.w #$00FF
	TAX
	LDA.l DATA_score_char_tiles,x
	STA.w $7EB42D,y
	LDA.l DATA_01B8DD,x
	STA.w $7EB46D,y
CODE_01CFCA:
	LDX.b $00
	CPX.b #$15
	BCS.b CODE_01CFE6
	LDA.l DATA_01B84A,x
	AND.w #$00FF
	TAX
	LDA.l DATA_score_char_tiles,x
	STA.w $7EB4ED,y
	LDA.l DATA_01B8DD,x
	STA.w $7EB52D,y
CODE_01CFE6:
	INY
	INY
	INC.b $00
	LDX.b $00
	CPX.b #$18
	BCC.b CODE_01CFA3
	JSR.w CODE_pause_show_stars
	JSR.w CODE_pause_show_red_coins
	JSR.w CODE_pause_show_flowers
	JSR.w CODE_pause_write_score
	JSR.w CODE_pause_write_high_score
	JSR.w CODE_pause_write_status_line
	JSR.w CODE_pause_write_item_cursor
	REP.b #$10
	LDY.w #$7EAFDF>>16
	STY.b $01
	LDY.w #$3400
	LDX.w #$7EAFDF
	LDA.w #$0700
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$10
	PLB
	LDX.b #$09
	STX.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDX.b #$34
	STX.w !RAM_YI_Global_BG3AddressAndSize
	LDX.b #$02
	STX.w !RAM_YI_Global_BG3And4TileDataDesignation
	STX.w $011C
	LDA.w #$0014
	STA.w !RAM_YI_Global_MainScreenLayers
	RTS

;---------------------------------------------------------------------------

CODE_01D035:
CODE_pause_show_stars:
	STZ.b $18
	LDY.b #$00
	STZ.b $00
	LDA.l $0003B6
	BEQ.b CODE_01D05D
CODE_01D041:
	CMP.w #$000A
	BCC.b CODE_01D04E
	SEC
	SBC.w #$000A
	INC.b $00
	BRA.b CODE_01D041

CODE_01D04E:
	LDA.b $00
	CMP.w #$001E
	BCC.b CODE_01D05D
	LDA.w #$0400
	STA.b $18
	LDA.w #$001E
CODE_01D05D:
	STA.b $00
CODE_01D05F:
	CMP.w #$000A
	BCC.b CODE_01D06A
	SBC.w #$000A
	INY
	BRA.b CODE_01D05F

CODE_01D06A:
	ASL
	TAX
	PHX
	PHY
	LDX.b #$00
	TXY
CODE_01D071:
	PHX
	LDA.l DATA_01B7ED,x
	AND.w #$00FF
	TAX
	LDA.l DATA_score_char_tiles,x
	ORA.b $18
	STA.w $7EB1A7,y
	LDA.l DATA_01B8DD,x
	ORA.b $18
	STA.w $7EB1E7,y
	PLX
	INY
	INY
	INX
	CPX.b #$18
	BCC.b CODE_01D071
	PLY
	PLX
	LDA.b $00
	PHA
	REP.b #$10
	PHX
	PHY
	SEP.b #$10
	LDA.w #$7EB1C1
	STA.b $10
	LDA.w #$7EB1CF
	STA.b $12
	LDA.w #$7EB201
	STA.b $14
	LDA.w #$7EB20F
	STA.b $16
	JSR.w CODE_score_screen_write_number
	REP.b #$10
	PLA
	AND.w #$00FF
	TAX
	PLA
	AND.w #$00FF
	STA.b $00
	LDA.b $18
	STA.b $02
	LDA.w #$7EB215>>16
	STA.b $15
	LDA.w #$7EB215
	STA.b $13
	PHB
	PHK
	PLB
	JSR.w CODE_score_pluralize_pts
	PLB
	SEP.b #$10
	PLA
	STA.b $00
	RTS

;---------------------------------------------------------------------------

CODE_01D0DE:
CODE_pause_show_red_coins:
	STZ.b $18
	LDY.b #$00
	LDA.l $0003B4
	CMP.w #$0014
	BCC.b CODE_01D0F3
	LDA.w #$0400
	STA.b $18
	LDA.w #$0014
CODE_01D0F3:
	STA.b $02
CODE_01D0F5:
	CMP.w #$000A
	BCC.b CODE_01D100
	SBC.w #$000A
	INY
	BRA.b CODE_01D0F5

CODE_01D100:
	ASL
	TAX
	PHX
	PHY
	LDX.b #$00
	TXY
CODE_01D107:
	PHX
	LDA.l DATA_01B805,x
	AND.w #$00FF
	TAX
	LDA.l DATA_score_char_tiles,x
	ORA.b $18
	STA.w $7EB267,y
	LDA.l DATA_01B8DD,x
	ORA.b $18
	STA.w $7EB2A7,y
	PLX
	INY
	INY
	INX
	CPX.b #$18
	BCC.b CODE_01D107
	PLY
	PLX
	LDA.b $00
	PHA
	LDA.b $02
	PHA
	REP.b #$10
	PHX
	PHY
	SEP.b #$10
	LDA.w #$7EB281
	STA.b $10
	LDA.w #$7EB28F
	STA.b $12
	LDA.w #$7EB2C1
	STA.b $14
	LDA.w #$7EB2CF
	STA.b $16
	JSR.w CODE_score_screen_write_number
	REP.b #$10
	PLA
	AND.w #$00FF
	TAX
	PLA
	AND.w #$00FF
	STA.b $00
	LDA.b $18
	STA.b $02
	LDA.w #$7EB2D5>>16
	STA.b $15
	LDA.w #$7EB2D5
	STA.b $13
	PHB
	PHK
	PLB
	JSR.w CODE_score_pluralize_pts
	PLB
	SEP.b #$10
	PLA
	STA.b $02
	PLA
	STA.b $00
	RTS

;---------------------------------------------------------------------------

CODE_01D17A:
CODE_pause_show_flowers:
	STZ.b $18
	LDA.l $0003B8
	ASL
	TAX
	CPX.b #$0A
	BCC.b CODE_01D18B
	LDA.w #$0400
	STA.b $18
CODE_01D18B:
	PHX
	LDX.b #$00
	TXY
CODE_01D18F:
	PHX
	LDA.l DATA_01B81D,x
	AND.w #$00FF
	TAX
	LDA.l DATA_score_char_tiles,x
	ORA.b $18
	STA.w $7EB327,y
	LDA.l DATA_01B8DD,x
	ORA.b $18
	STA.w $7EB367,y
	PLX
	INY
	INY
	INX
	CPX.b #$18
	BCC.b CODE_01D18F
	PLX
	LDA.b $00
	PHA
	LDA.b $02
	PHA
	REP.b #$10
	PHX
	SEP.b #$10
	LDA.l DATA_01B8AF,x
	ORA.b $18
	STA.w $7EB345
	TXY
	BEQ.b CODE_01D1CD
	STA.w $7EB34F
CODE_01D1CD:
	LDA.l DATA_01B92D,x
	ORA.b $18
	STA.w $7EB385
	TXY
	BEQ.b CODE_01D1DC
	STA.w $7EB38F
CODE_01D1DC:
	REP.b #$10
	PLA
	AND.w #$00FF
	TAX
	STX.b $00
	LDA.b $18
	STA.b $02
	LDA.w #$7EB395>>16
	STA.b $15
	LDA.w #$7EB395
	STA.b $13
	PHB
	PHK
	PLB
	JSR.w CODE_score_pluralize_pts
	PLB
	SEP.b #$10
	PLA
	STA.b $02
	PLA
	STA.b $00
	RTS

;---------------------------------------------------------------------------

CODE_01D203:
CODE_pause_write_score:
	STZ.b $18
	LDY.b #$00
	LDA.l $0003B8
	ASL
	STA.b $0E
	ASL
	ASL
	ADC.b $0E
	CLC
	ADC.b $00
	CLC
	ADC.b $02
	STA.b $00
	CMP.w #$0064
	BCC.b CODE_01D226
	LDA.w #$000A
	TAY
	INY
	BRA.b CODE_01D231

CODE_01D226:
	CMP.w #$000A
	BCC.b CODE_01D231
	SBC.w #$000A
	INY
	BRA.b CODE_01D226

CODE_01D231:
	ASL
	TAX
	LDA.b $00
	PHA
	REP.b #$10
	PHX
	PHY
	SEP.b #$10
	LDA.w #$7EB44F
	STA.b $10
	STA.b $12
	LDA.w #$7EB48F
	STA.b $14
	STA.b $16
	JSR.w CODE_score_screen_write_number
	REP.b #$10
	PLA
	AND.w #$00FF
	TAX
	PLA
	AND.w #$00FF
	STA.b $00
	LDA.b $18
	STA.b $02
	LDA.w #$7EB495>>16
	STA.b $15
	LDA.w #$7EB495
	STA.b $13
	PHB
	PHK
	PLB
	JSR.w CODE_score_pluralize_pts
	PLB
	SEP.b #$10
	PLA
	STA.b $00
	RTS

;---------------------------------------------------------------------------

CODE_01D275:
CODE_pause_write_high_score:
	LDY.b #$00
	LDA.l $00021A
	TAX
	LDA.l $0002B8,x
	AND.w #$00FF
	CMP.b $00
	BCS.b CODE_01D289
	LDA.b $00
CODE_01D289:
	CMP.w #$0064
	BCC.b CODE_01D295
	LDA.w #$000A
	TAY
	INY
	BRA.b CODE_01D2A0

CODE_01D295:
	CMP.w #$000A
	BCC.b CODE_01D2A0
	SBC.w #$000A
	INY
	BRA.b CODE_01D295

CODE_01D2A0:
	ASL
	TAX
	REP.b #$10
	PHX
	PHY
	SEP.b #$10
	LDA.w #$7EB50F
	STA.b $10
	STA.b $12
	LDA.w #$7EB54F
	STA.b $14
	STA.b $16
	STZ.b $18
	JSR.w CODE_score_screen_write_number
	REP.b #$10
	PLA
	AND.w #$00FF
	TAX
	PLA
	AND.w #$00FF
	STA.b $00
	LDA.b $18
	STA.b $02
	LDA.w #$7EB555>>16
	STA.b $15
	LDA.w #$7EB555
	STA.b $13
	PHB
	PHK
	PLB
	JSR.w CODE_score_pluralize_pts
	PLB
	SEP.b #$10
	RTS

;---------------------------------------------------------------------------

CODE_01D2E0:
CODE_pause_write_item_cursor:
	PHB
	PHK
	PLB
	STZ.w $0CF6
	STZ.w $0CF7
	SEP.b #$20
	LDX.b #$00
	TXY
CODE_01D2EE:
	LDA.w !RAM_YI_Level_PauseMenuItemInventory,x
	AND.b #$0F
	BEQ.b CODE_01D2F9
	STA.w !RAM_YI_Level_PauseMenuItemInventory,y
	INY
CODE_01D2F9:
	INX
	CPX.b #$1B
	BCC.b CODE_01D2EE
	TYX
CODE_01D2FF:
	CPX.b #$1B
	BCS.b CODE_01D309
	STZ.w !RAM_YI_Level_PauseMenuItemInventory,x
	INX
	BRA.b CODE_01D2FF

CODE_01D309:
	LDA.w !RAM_YI_Level_PauseMenuItemInventory
	BEQ.b CODE_01D32F
	LDY.b #$00
	LDA.w !RAM_YI_Level_PauseScreenCursorLoc1
	BNE.b CODE_01D31B
	STZ.w !RAM_YI_Level_PauseScreenCursorLoc2
	INC.w !RAM_YI_Level_PauseScreenCursorLoc1
CODE_01D31B:
	LDX.w !RAM_YI_Level_PauseScreenCursorLoc2
CODE_01D31E:
	LDA.w !RAM_YI_Level_PauseMenuItemInventory,x
	STA.w $0CF6,y
	INX
	INY
	CPY.b #$03
	BCC.b CODE_01D31E
	REP.b #$20
	JSR.w CODE_pause_animate_item_box
CODE_01D32F:
	REP.b #$20
	PLB
	RTS

;---------------------------------------------------------------------------

DATA_01D333:
DATA_pause_big_number:
	dw $1DA8,$1D80,$1D82,$1D84,$1D86,$1D88,$1DA0,$1DA2
	dw $1DA4,$1DA6

DATA_01D347:
	dw $1DB8,$1D90,$1D92,$1D94,$1D96,$1D98,$1DB0,$1DB2
	dw $1DB4,$1DB6

CODE_01D35B:
CODE_pause_write_status_line:
	LDX.b #$00
CODE_01D35D:
	LDA.w #$9D8B
	STA.w $7EB59F,x
	LDA.w #$1D8B
	STA.w $7EB65F,x
	LDA.w #$09AF
	STA.w $7EB5DF,x
	STA.w $7EB61F,x
	INX
	INX
	CPX.b #$40
	BCC.b CODE_01D35D
	LDA.w #$098C
	STA.w $7EB5E1
	INC
	STA.w $7EB5E3
	INC
	STA.w $7EB621
	INC
	STA.w $7EB623
	LDX.b #$00
	TXY
	LDA.l $000379
CODE_01D391:
	CMP.w #$0064
	BCC.b CODE_01D39C
	SBC.w #$0064
	INY
	BRA.b CODE_01D391

CODE_01D39C:
	CMP.w #$000A
	BCC.b CODE_01D3A7
	SBC.w #$000A
	INX
	BRA.b CODE_01D39C

CODE_01D3A7:
	CPY.b #$00
	BNE.b CODE_01D3B9
	TXY
	TAX
	LDA.w #$000A
	CPY.b #$00
	BNE.b CODE_01D3B9
	TXY
	TAX
	LDA.w #$000A
CODE_01D3B9:
	ORA.w #$0DC0
	STA.w $7EB629
	TXA
	ORA.w #$0DC0
	STA.w $7EB627
	TYA
	ORA.w #$0DC0
	STA.w $7EB625
	LDA.w #$0DD2
	STA.w $7EB5EB
	INC
	STA.w $7EB5ED
	INC
	STA.w $7EB62B
	INC
	STA.w $7EB62D
	LDX.b #$00
	LDA.l $00037B
CODE_01D3E5:
	CMP.w #$000A
	BCC.b CODE_01D3F0
	SBC.w #$000A
	INX
	BRA.b CODE_01D3E5

CODE_01D3F0:
	CPX.b #$00
	BNE.b CODE_01D3F8
	TAX
	LDA.w #$000A
CODE_01D3F8:
	ORA.w #$0DC0
	STA.w $7EB631
	TXA
	ORA.w #$0DC0
	STA.w $7EB62F
	LDA.w #$0DCB
	STA.w $7EB5F5
	INC
	STA.w $7EB5F7
	INC
	STA.w $7EB635
	INC
	STA.w $7EB637
	LDA.l $0003A1
	ASL
	TAX
	LDA.l DATA_pause_big_number,x
	STA.w $7EB5F9
	INC
	STA.w $7EB5FB
	LDA.l DATA_01D347,x
	STA.w $7EB639
	INC
	STA.w $7EB63B
	LDA.l $0003A3
	ASL
	TAX
	LDA.l DATA_pause_big_number,x
	STA.w $7EB5FD
	INC
	STA.w $7EB5FF
	LDA.l DATA_01D347,x
	STA.w $7EB63D
	INC
	STA.w $7EB63F
	JSR.w CODE_pause_draw_item_boxes
	SEP.b #$20
	PHB
	PHK
	PLB
	JSR.w CODE_pause_draw_arrows
	PLB
	REP.b #$20
	RTS

;---------------------------------------------------------------------------

CODE_01D45E:
CODE_score_screen_write_number:
	PHY
	LDY.b #$02
	LDA.l DATA_01B8AF,x
	ORA.b $18
	STA.b ($10),y
	STA.b ($12),y
	LDA.l DATA_01B92D,x
	ORA.b $18
	STA.b ($14),y
	STA.b ($16),y
	PLY
	BEQ.b CODE_01D48F
	TYA
	ASL
	TAX
	LDA.l DATA_01B8AF,x
	ORA.b $18
	STA.b ($10)
	STA.b ($12)
	LDA.l DATA_01B92D,x
	ORA.b $18
	STA.b ($14)
	STA.b ($16)
CODE_01D48F:
	RTS

;---------------------------------------------------------------------------

CODE_01D490:
CODE_pause_draw_item_boxes:
	LDA.w #$1DAC
	STA.w $7EB5C7
	LDA.w #$1D9C
	STA.w $7EB607
	STA.w $7EB647
	LDA.w #$9DAC
	STA.w $7EB687
	LDA.w #$1DAD
	STA.w $7EB5C9
	STA.w $7EB5CF
	STA.w $7EB5D5
	LDA.w #$5DAD
	STA.w $7EB5CB
	STA.w $7EB5D1
	STA.w $7EB5D7
	LDA.w #$9DAD
	STA.w $7EB689
	STA.w $7EB68F
	STA.w $7EB695
	LDA.w #$DDAD
	STA.w $7EB68B
	STA.w $7EB691
	STA.w $7EB697
	LDA.w #$1DAE
	STA.w $7EB5CD
	STA.w $7EB5D3
	LDA.w #$9DAE
	STA.w $7EB68D
	STA.w $7EB693
	LDA.w #$1D9E
	STA.w $7EB60D
	STA.w $7EB613
	STA.w $7EB64D
	STA.w $7EB653
	LDA.w #$5DAC
	STA.w $7EB5D9
	LDA.w #$5D9C
	STA.w $7EB619
	STA.w $7EB659
	LDA.w #$DDAC
	STA.w $7EB699
	LDA.w #$117F
	STA.w $7EB609
	STA.w $7EB649
	STA.w $7EB60B
	STA.w $7EB64B
	STA.w $7EB60F
	STA.w $7EB64F
	STA.w $7EB611
	STA.w $7EB651
	STA.w $7EB615
	STA.w $7EB655
	STA.w $7EB617
	STA.w $7EB657
	RTS

;---------------------------------------------------------------------------

CODE_01D533:
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	LDX.w $7E4800
	STA.w $0000,x
	ASL
	LDA.w #$0080
	STA.w $0002,x
	LDA.w #$007E
	STA.w $0007,x
	TYA
	STA.w $0008,x
	LDA.w #$3981
	LDY.w #$7BBE
	BCS.b CODE_01D55D
	LDA.w #$1801
	INY
	INY
CODE_01D55D:
	STA.w $0003,x
	TYA
	STA.w $0005,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	STA.w $7E4800
	SEP.b #$30
	PLB
	RTS

;---------------------------------------------------------------------------

DATA_01D573:
DATA_bg_gradient_ptrs:
	dw DATA_5FD64C>>16,DATA_5FD64C
	dw DATA_5FD67C>>16,DATA_5FD67C
	dw DATA_5FD6AC>>16,DATA_5FD6AC
	dw DATA_5FD6DC>>16,DATA_5FD6DC
	dw DATA_5FD70C>>16,DATA_5FD70C
	dw DATA_5FD73C>>16,DATA_5FD73C
	dw DATA_5FD76C>>16,DATA_5FD76C
	dw DATA_5FD79C>>16,DATA_5FD79C
	dw DATA_5FD7CC>>16,DATA_5FD7CC
	dw DATA_5FD7FC>>16,DATA_5FD7FC
	dw DATA_5FD82C>>16,DATA_5FD82C
	dw DATA_5FD85C>>16,DATA_5FD85C
	dw DATA_5FD88C>>16,DATA_5FD88C
	dw DATA_5FD8BC>>16,DATA_5FD8BC
	dw DATA_5FD8EC>>16,DATA_5FD8EC
	dw DATA_5FD91C>>16,DATA_5FD91C

;-------------------------------------------------------------------------
; CODE_hdma_and_gradient_init.
; See also: ys_dma.asm (DMA/HDMA register-block conventions).
; Deep dive: docs/bossengine.md section 4 (per-channel HDMA layout).
; Called once per level-load by gm0c to arm HDMA channels 1..7 and
; populate the BG3 gradient tables. Sets DB = $01.
;
; Per-channel setup loop ($1D5B8): for each of the 7 channels, writes
; a 5-byte HDMA control block (mode/dest/indirect-source-LO/MI) from
; DATA_01D66B/70/75/81/8D/99/A5 (one block per channel). The
; indirect-source-bank for channels 3..7 is $7E (the WRAM gradient
; table); for channels 1..2 it is $7F.
;
; Then copies the per-channel "indirect-table head + tail" 7-byte
; records from DATA_hdma_indirect_table_1/86/92/9E/AA into the WRAM gradient buffer
; at $7E:5B18 / 5B98 / 5C18 / 5C98 / 5D18.
;
; If !RAM_YI_Level_LevelHeaderBackgroundColorLo >= $10 (custom
; gradient), uses SuperFX FXCODE_0890E7 with parameters from
; DATA_bg_gradient_ptrs to GENERATE the gradient lookup at $70:5800; then
; CODE_dma_wram_gen_purpose DMAs it to $7F:56DE. Otherwise X = 0 (HDMAEnable stays
; off for the gradient channels).
;
; Finally: !RAM_YI_Global_HDMAEnable = X (the channel-enable mask).
;
; INPUTS:    !RAM_YI_Level_LevelHeaderBackgroundColorLo
; OUTPUTS:   HDMA channels 1..7 armed; gradient data populated;
;            !RAM_YI_Global_HDMAEnable = channel mask
; MODIFIES:  A, X, Y, DB, ALL HDMA channel-config registers, $7E:5B18..$5D18,
;            $7F:56DE+0x522, !REGISTERSuperFX scratch
; CALLERS:   CODE_gm0c_level_fadein_and_name (via CODE_01B118 path).
;-------------------------------------------------------------------------
CODE_01D5B3:
CODE_hdma_and_gradient_init:
	PHB
	PHK
	PLB
	LDX.b #$04
CODE_01D5B8:
	LDA.w DATA_01D66B,x
	STA.w HDMA[$06].Parameters,x
	LDA.w DATA_hdma_channel_7_init,x
	STA.w HDMA[$07].Parameters,x
	LDA.w DATA_hdma_channel_5_init,x
	STA.w HDMA[$05].Parameters,x
	LDA.w DATA_hdma_channel_4_init,x
	STA.w HDMA[$04].Parameters,x
	LDA.w DATA_hdma_channel_3_init,x
	STA.w HDMA[$03].Parameters,x
	LDA.w DATA_hdma_channel_2_init,x
	STA.w HDMA[$02].Parameters,x
	LDA.w DATA_hdma_channel_1_init,x
	STA.w HDMA[$01].Parameters,x
	DEX
	BPL.b CODE_01D5B8
	LDA.b #$7E5040>>16
	STA.w HDMA[$06].IndirectSourceBank
	STA.w HDMA[$07].IndirectSourceBank
	STA.w HDMA[$05].IndirectSourceBank
	STA.w HDMA[$04].IndirectSourceBank
	STA.w HDMA[$03].IndirectSourceBank
	LDA.b #$7F56DE>>16
	STA.w HDMA[$02].IndirectSourceBank
	STA.w HDMA[$01].IndirectSourceBank
	LDX.b #$06
CODE_01D600:
	LDA.w DATA_hdma_indirect_table_1,x
	STA.l $7E5B18,x
	LDA.w DATA_hdma_indirect_table_2,x
	STA.l $7E5B98,x
	LDA.w DATA_hdma_indirect_table_3,x
	STA.l $7E5C18,x
	LDA.w DATA_hdma_indirect_table_4,x
	STA.l $7E5C98,x
	LDA.w DATA_hdma_indirect_table_5,x
	STA.l $7E5D18,x
	DEX
	BPL.b CODE_01D600
	LDX.b #$00
	LDA.w !RAM_YI_Level_LevelHeaderBackgroundColorLo
	CMP.b #$10
	BCC.b CODE_01D666
	ASL
	ASL
	TAY
	REP.b #$20
	LDA.w DATA_bg_gradient_ptrs-$40,y
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_bg_gradient_ptrs-$3E,y
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDX.b #FXCODE_0890E7>>16
	LDA.w #FXCODE_0890E7
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$7F56DE
	STA.b $20
	LDY.b #$7F56DE>>16
	STY.b $22
	LDA.w #$705800
	STA.b $23
	LDY.b #$705800>>16
	STY.b $25
	LDA.w #$0522
	JSL.l CODE_dma_wram_gen_purpose
	SEP.b #$20
	LDX.b #$06
CODE_01D666:
	STX.w !RAM_YI_Global_HDMAEnable
	PLB
	RTL

DATA_01D66B:
	db $01,!REGISTER_MainScreenLayers : dl $7E51E4

DATA_01D670:
DATA_hdma_channel_7_init:
	db $03,!REGISTER_BG3HorizScrollOffset : dl $7E552C

DATA_01D675:
DATA_hdma_channel_5_init:
	db $44,!REGISTER_Window1LeftPositionDesignation : dl $7E5B18

DATA_01D67A:
DATA_hdma_indirect_table_1:
	db $E9 : dw $7E56D0
	db $E9 : dw $7E5874
	db $00

DATA_01D681:
DATA_hdma_channel_4_init:
	db $42,!REGISTER_BG3VertScrollOffset : dl $7E5B98

DATA_01D686:
DATA_hdma_indirect_table_2:
	db $E9 : dw $7E5040
	db $E9 : dw $7E5112
	db $00

DATA_01D68D:
DATA_hdma_channel_3_init:
	db $42,!REGISTER_BG3HorizScrollOffset : dl $7E5C18

DATA_01D692:
DATA_hdma_indirect_table_3:
	db $E9 : dw $7E51E4
	db $E9 : dw $7E52B6
	db $00

DATA_01D699:
DATA_hdma_channel_2_init:
	db $42,!REGISTER_FixedColorData : dl $7E5C98

DATA_01D69E:
DATA_hdma_indirect_table_4:
	db $E9 : dw $7F5894
	db $E9 : dw $7F5966
	db $00

DATA_01D6A5:
DATA_hdma_channel_1_init:
	db $40,!REGISTER_FixedColorData : dl $7E5D18

DATA_01D6AA:
DATA_hdma_indirect_table_5:
	db $E9 : dw $7F56DE
	db $E9 : dw $7F5747
	db $00

;---------------------------------------------------------------------------

CODE_01D6B1:
CODE_hdma_per_frame_dispatch:                  ; gm$0F per-frame HDMA selector: if $0D2D/$0D3D/$0D27/$0D2B/$0D45/$0D3B set, dispatch to fuzzy/sun/wavy/clouds and update BG3 stripe via FXCODE_08BE12
	LDA.w $0D2D
	BEQ.b CODE_01D6BB
	JSR.w CODE_hdma_per_frame_fuzzy
	BRA.b CODE_01D6C3

CODE_01D6BB:
	LDA.w $0D3D
	BEQ.b CODE_01D6C3
	JSR.w CODE_hdma_per_frame_sun
CODE_01D6C3:
	LDX.w $0D27
	BEQ.b CODE_01D6CD
	JSR.w CODE_hdma_per_frame_layer1_y_stripe
	BRA.b CODE_01D6DF

CODE_01D6CD:
	LDA.w $0D2B
	BEQ.b CODE_01D6D7
	JSR.w CODE_hdma_per_frame_wavy
	BRA.b CODE_01D6DF

CODE_01D6D7:
	LDA.w $0D45
	BEQ.b CODE_01D6DF
	JSR.w CODE_hdma_per_frame_clouds
CODE_01D6DF:
	LDX.w $0D3B
	BNE.b CODE_01D6E5
	RTS

CODE_01D6E5:
	REP.b #$20
	LDA.w $609A,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08BE12>>16
	LDA.w #FXCODE_08BE12
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	SEC
	SBC.w #$385E
	JSL.l CODE_queue_dma_3args_plus_a	: dl $7E552C,$70385E
	LDA.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	CMP.w #$0001
	BEQ.b CODE_01D715
	SEP.b #$20
	LDA.b #$80
	BRA.b CODE_01D791

CODE_01D715:
	LDA.w #$06FF
	SEC
	SBC.b !RAM_YI_Global_Layer1YPosLo
	BCS.b CODE_01D724
	SEP.b #$20
	LDA.w !RAM_YI_Global_MainScreenLayers
	BRA.b CODE_01D72D

CODE_01D724:
	CMP.w #$00D2
	SEP.b #$20
	BCC.b CODE_01D747
	LDA.b #$17
CODE_01D72D:
	STA.l $7E51E5
	EOR.b #$04
	AND.b #$04
	STA.l $7E51E6
	LDA.b #$01
	STA.l $7E51E4
	LDA.b #$00
	STA.l $7E51E7
	BRA.b CODE_01D78F

CODE_01D747:
	LDX.b #$00
	CMP.b #$80
	BCC.b CODE_01D766
	SBC.b #$7F
	PHA
	LDA.b #$7F
	STA.l $7E51E4,x
	LDA.b #$17
	STA.l $7E51E5,x
	LDA.b #$00
	STA.l $7E51E6,x
	PLA
	INX
	INX
	INX
CODE_01D766:
	STA.l $7E51E4,x
	LDA.b #$01
	STA.l $7E51E7,x
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.l $7E51E8,x
	LDA.b #$04
	STA.l $7E51E9,x
	LDA.b #$17
	STA.l $7E51E5,x
	LDA.b #$00
	STA.l $7E51E6,x
	LDA.b #$00
	STA.l $7E51EA,x
CODE_01D78F:
	LDA.b #$C0
CODE_01D791:
	TSB.w !RAM_YI_Global_HDMAEnable
	RTS

CODE_01D795:
CODE_hdma_per_frame_layer1_y_stripe:           ; per-frame BG2 hor-mod build for "moving stripe" effect: SuperFX FXCODE_08DD23 reads DATA_01EC96, output -> $7E:5040 via CODE_queue_dma_3args_plus_a
	REP.b #$20
	DEX
	LDA.b !RAM_YI_Global_Layer1YPosLo,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w #DATA_01EC96>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w $0D28
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w #$3372
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_08DC26>>16
	LDA.w #FXCODE_08DC26
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$01A4
	JSL.l CODE_queue_dma_3args_plus_a	: dl $7E5040,$703372
	SEP.b #$20
	LDA.b #$10
	TSB.w !RAM_YI_Global_HDMAEnable
	RTS

;---------------------------------------------------------------------------

CODE_01D7CD:
CODE_hdma_per_frame_fuzzy:                     ; per-frame fuzzy-effect HDMA setup: SuperFX FXCODE_08DD23 builds BG3 wavy indirect table, enables HDMA bit $08
	REP.b #$20
	LDA.w $0D2D
	AND.w #$0002
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $609E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $0D39
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $0D31
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w #DATA_01E8CD>>16
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$36BA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDX.b #FXCODE_08DD23>>16
	LDA.w #FXCODE_08DD23
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$01A4
	JSL.l CODE_queue_dma_3args_plus_a	: dl $7E51E4,$7036BA
	SEP.b #$20
	LDA.b #$08
	TSB.w !RAM_YI_Global_HDMAEnable
	RTS

;---------------------------------------------------------------------------

CODE_01D81D:
CODE_hdma_per_frame_wavy:                      ; per-frame wavy-water HDMA setup: SuperFX FXCODE_08DC4D builds BG2 horizontal scroll mod, enables HDMA bit $10
	REP.b #$20
	LDA.w $0D2B
	AND.w #$0002
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $0D37
	STA.w $6000
	LDA.w $609E
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $0D2F
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #DATA_01E8C7>>16
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$3372
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDX.b #FXCODE_08DC4D>>16
	LDA.w #FXCODE_08DC4D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$01A4
	JSL.l CODE_queue_dma_3args_plus_a	: dl $7E5040,$703372
	SEP.b #$20
	LDA.b #$10
	TSB.w !RAM_YI_Global_HDMAEnable
	RTS

;---------------------------------------------------------------------------

CODE_01D86D:
CODE_hdma_per_frame_sun:                       ; per-frame sun-rays HDMA setup: SuperFX FXCODE_08DC4D builds BG3 indirect-source for sun gradient, enables HDMA bit $08
	REP.b #$20
	LDA.w $0D3D
	AND.w #$0002
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $0D43
	STA.w $6000
	LDA.w $60A0
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $0D3F
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #DATA_01EB7D>>16
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$36BA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDX.b #FXCODE_08DC4D>>16
	LDA.w #FXCODE_08DC4D
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$01A4
	JSL.l CODE_queue_dma_3args_plus_a	: dl $7E51E4,$7036BA
	LDA.l $7036BA
	STA.w $6098
	STA.b !RAM_YI_Global_Layer3XPosLo
	SEP.b #$20
	LDA.b #$08
	TSB.w !RAM_YI_Global_HDMAEnable
	RTS

;---------------------------------------------------------------------------

CODE_01D8C6:
CODE_hdma_per_frame_clouds:                    ; per-frame cloud-mist HDMA setup: SuperFX FXCODE_08DD23 builds BG2 horizontal mod via DATA_01ECD2, enables HDMA bit $10
	REP.b #$20
	LDA.w $0D45
	AND.w #$0002
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $60A0
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $0D4B
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $0D47
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w #DATA_01ECD2>>16
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w #$3372
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	LDX.b #FXCODE_08DD23>>16
	LDA.w #FXCODE_08DD23
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$01A4
	JSL.l CODE_queue_dma_3args_plus_a	: dl $7E5040,$703372
	SEP.b #$20
	LDA.b #$10
	TSB.w !RAM_YI_Global_HDMAEnable
	RTS

;---------------------------------------------------------------------------

DATA_01D916:
DATA_offset_per_tile_mode_ptr:
	dw CODE_opt_moving_platforms
	dw CODE_opt_fuzzied
	dw CODE_opt_unused

DATA_01D91C:
DATA_fuzzy_tint_colors:
	dw $1402,$2000,$00E0,$00C3,$00A5,$0008,$0804,$1004

;-------------------------------------------------------------------------
; CODE_opt_fuzzied. Per-tile-mode option 1 (dispatched from
; gamemode 0F via DATA_offset_per_tile_mode_ptr[1]). Applies the "FUZZY mosaic" effect
; when the player has touched a fuzzy: chromatic-shift palette via
; DATA_fuzzy_tint_colors, jittering BG positions via $0D2B / $0D2D / $0D37 / $0D39.
; Plays sound $22 when fuzzy ends.
; INPUTS: $7FE8 (fuzzy timer), !RAM_YI_Level_FuzzyEffectAmplitudeLo,
;         !RAM_YI_Level_FuzzyEffectFrameCounterLo
; CALLERS: CODE_main_gamemode_0F via DATA_offset_per_tile_mode_ptr[1] when $61CA == 1.
;-------------------------------------------------------------------------
CODE_01D92C:
CODE_opt_fuzzied:
	STZ.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$13
	STA.w !RAM_YI_Global_SubScreenLayers
	REP.b #$20
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_01D946
	LDA.w $7FE8
	BNE.b CODE_01D960
CODE_01D946:
	LDA.w $0D37
	ORA.w $0D39
	BNE.b CODE_01D95D
	STZ.w $0D2B
	STZ.w $0D2D
	LDA.w !RAM_YI_Global_HDMAEnable
	AND.w #$FFE7
	STA.w !RAM_YI_Global_HDMAEnable
CODE_01D95D:
	JMP.w CODE_01DA51

CODE_01D960:
	DEC
	BNE.b CODE_01D9BD
	LDA.w !RAM_YI_Level_FuzzyEffectAmplitudeLo
	BEQ.b CODE_01D974
	SEC
	SBC.w #$0100
	STA.w !RAM_YI_Level_FuzzyEffectAmplitudeLo
	BPL.b CODE_01D974
	STZ.w !RAM_YI_Level_FuzzyEffectAmplitudeLo
CODE_01D974:
	LDA.w !RAM_YI_Level_FuzzyEffectFrameCounterLo
	AND.w #$00FF
	BEQ.b CODE_01D97F
	JMP.w CODE_01DA1C

CODE_01D97F:
	LDA.l $702F6C
	BNE.b CODE_01D9B4
	LDA.w !RAM_YI_Level_FuzzyEffectAmplitudeLo
	BNE.b CODE_01D99C
	LDA.w #!Define_YI_SoundID22_EndFuzzyDistortedMusic
	JSL.l CODE_push_sound_queue
	STZ.w $7FE8
	STZ.w $0D37
	STZ.w $0D39
	BRA.b CODE_01D9B1

CODE_01D99C:
	AND.w #$0100
	BNE.b CODE_01D9B1
	DEC.w $0D37
	BPL.b CODE_01D9A9
	STZ.w $0D37
CODE_01D9A9:
	DEC.w $0D39
	BPL.b CODE_01D9B1
	STZ.w $0D39
CODE_01D9B1:
	JMP.w CODE_01DA47

CODE_01D9B4:
	LDA.w #$0000
	STA.l $702F6C
	BRA.b CODE_01DA11

CODE_01D9BD:
	DEC.w $7FE8
	LDA.w !RAM_YI_Level_FuzzyEffectAmplitudeLo
	CLC
	ADC.w #$0080
	CMP.w #$6000
	BCC.b CODE_01D9CF
	LDA.w #$6000
CODE_01D9CF:
	STA.w !RAM_YI_Level_FuzzyEffectAmplitudeLo
	AND.w #$0380
	BNE.b CODE_01D9EF
	LDA.w $0D37
	INC
	CMP.w #$0018
	BCS.b CODE_01D9E3
	STA.w $0D37
CODE_01D9E3:
	LDA.w $0D39
	INC
	CMP.w #$000C
	BCS.b CODE_01D9EF
	STA.w $0D39
CODE_01D9EF:
	LDA.w #$0003
	STA.w $0D2B
	LDA.w #$0001
	STA.w $0D2D
	LDA.w !RAM_YI_Level_FuzzyEffectFrameCounterLo
	AND.w #$00FF
	BNE.b CODE_01DA1C
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$000E
	TAX
	LDA.w DATA_fuzzy_tint_colors,x
	STA.l $702F6C
CODE_01DA11:
	STZ.w !RAM_YI_Level_FuzzyEffectFrameCounterLo
	LDA.l YI_Global_PaletteMirror[$00].LowByte
	STA.l $702D6C
CODE_01DA1C:
	LDA.w !RAM_YI_Level_FuzzyEffectFrameCounterLo
	CLC
	ADC.w #$0008
	STA.w !RAM_YI_Level_FuzzyEffectFrameCounterLo
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.l $702D6C
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.l $702F6C
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_08E132>>16
	LDA.w #FXCODE_08E132
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	STA.l YI_Global_PaletteMirror[$00].LowByte
CODE_01DA47:
	LDA.w !RAM_YI_Level_FuzzyEffectPositionOffsetLo
	CLC
	ADC.w #$0020
	STA.w !RAM_YI_Level_FuzzyEffectPositionOffsetLo
CODE_01DA51:
	LDA.w !RAM_YI_Level_FuzzyEffectAmplitudeLo
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !RAM_YI_Level_FuzzyEffectPositionOffsetLo
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDX.b #FXCODE_089518>>16
	LDA.w #FXCODE_089518
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_opt_moving_platforms. Per-tile-mode option 0
; (dispatched from gamemode 0F via DATA_offset_per_tile_mode_ptr[0]). Each frame,
; advances global $0CFD (moving-platform parameter) by -2 unless
; sprites are frozen, then runs SuperFX FXCODE_089DCE to update
; per-tile platform positions based on $0CFD + Layer1XPos / Layer1YPos.
; CALLERS: CODE_main_gamemode_0F via DATA_offset_per_tile_mode_ptr[0].
;-------------------------------------------------------------------------
CODE_01DA69:
CODE_opt_moving_platforms:
	REP.b #$20
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_01DA79
	DEC.w $0CFD
	DEC.w $0CFD
CODE_01DA79:
	LDA.w $0CFD
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.b !RAM_YI_Global_Layer1XPosLo
	STA.w $7EEE
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_089DCE>>16
	LDA.w #FXCODE_089DCE
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_opt_unused. Per-tile-mode option 2 (DATA_offset_per_tile_mode_ptr[2]).
; Increments $0CFD modulo $60, then runs SuperFX FXCODE_0B96C3 with
; ($0CFD/8) and $60B0 to update some background effect. Not invoked
; by any standard level header in the V1.1 cart -- likely a developer-
; only or vestigial tile mode.
;-------------------------------------------------------------------------
CODE_01DA98:
CODE_opt_unused:
	REP.b #$20
	INC.w $0CFD
	LDA.w $0CFD
	CMP.w #$0060
	BCC.b CODE_01DAAB
	LDA.w #$0000
	STA.w $0CFD
CODE_01DAAB:
	LSR
	LSR
	LSR
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $60B0
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_0B96C3>>16
	LDA.w #FXCODE_0B96C3
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_ten_star_item. Pause-menu item: adds 10 to star-timer.
; Implemented as LDA #$0064 fall-through into CODE_star_item_main.
;-------------------------------------------------------------------------
CODE_01DAC3:
CODE_ten_star_item:
	LDA.w #$0064
;-------------------------------------------------------------------------
; CODE_star_item_main. Shared "star-collect" item logic.
; First call ($039A == 0): add A (10 or 20) to !RAM_YI_Level_StarTimerLo
; -> $0396, set $0B7F = total + $78 (display timer), INC $039A.
; Subsequent calls: when display timer ($0396) expires, clears
; !RAM_YI_Level_ItemBeingUsed.
; INPUTS:  A = star delta (10 or 20)
; CALLERS: DATA_01C0ED[0] (10-star), DATA_01C0ED[1] (20-star).
;-------------------------------------------------------------------------
CODE_01DAC6:
CODE_star_item_main:
	LDY.w $039A
	BNE.b CODE_01DADD
	CLC
	ADC.w $0396
	STA.w $0396
	CLC
	ADC.w #$0078
	STA.w $0B7F
	INC.w $039A
	RTS

CODE_01DADD:
	LDA.w $0396
	BNE.b CODE_01DAE5
	STZ.w !RAM_YI_Level_ItemBeingUsed
CODE_01DAE5:
	RTS

;-------------------------------------------------------------------------
; CODE_twenty_star_item. Pause-menu item: adds 20 to star-timer.
;-------------------------------------------------------------------------
CODE_01DAE6:
CODE_twenty_star_item:
	LDA.w #$00C8
	BRA.b CODE_star_item_main

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_pow_block_item. Pause-menu POW item:
; JSL CODE_0294B4 (Bank02 POW-effect: damages all visible enemies),
; play sound $47 (explosion), $61C6 = $20 (small screen shake),
; clear !RAM_YI_Level_ItemBeingUsed.
;-------------------------------------------------------------------------
CODE_01DAEB:
CODE_pow_block_item:
	JSL.l CODE_0294B4
	LDA.w #!Define_YI_SoundID47_Explosion
	JSL.l CODE_push_sound_queue
	LDA.w #$0020
	STA.w $61C6
	STZ.w !RAM_YI_Level_ItemBeingUsed
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_magnifying_glass_item. Reveals hidden items by INCing
; !EXRAM_YI_Level_ShowHiddenItemsFlag; plays sound $04, clears
; !RAM_YI_Level_ItemBeingUsed.
;-------------------------------------------------------------------------
CODE_01DB00:
CODE_magnifying_glass_item:
	INC.w !EXRAM_YI_Level_ShowHiddenItemsFlag|!EXRAMBankMirror
	LDA.w #!Define_YI_SoundID04_SpitOut
	JSL.l CODE_push_sound_queue
	STZ.w !RAM_YI_Level_ItemBeingUsed
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_full_egg_item. Spawns 6 follower eggs (sprite $00AB)
; behind Yoshi. First call: $039A == 0, spawn one egg via CODE_spawn_sprite_active
; + CODE_029AC6, INC $039A.
;-------------------------------------------------------------------------
CODE_01DB0E:
CODE_full_egg_item:
	LDY.w $039A
	BNE.b CODE_01DB24
	LDA.w #$00AB
	JSL.l CODE_spawn_sprite_active
	BCC.b CODE_01DB24
	TYX
	JSL.l CODE_029AC6
	INC.w $039A
CODE_01DB24:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_enemies_to_cloud_item. Pause-menu "cloud" item: scans
; sprite slots 0..$5C in steps of 4, for each active enemy (status>=$E)
; whose $6FA2 & $6000 == 0 (vulnerable), sets status = $06 (becoming-
; cloud) and queues sprite-ID $00CB (winged cloud with coin/star).
; Plays sound $3B (pop), clears !RAM_YI_Level_ItemBeingUsed.
;-------------------------------------------------------------------------
CODE_01DB25:
CODE_enemies_to_cloud_item:
	LDX.b #$5C
CODE_01DB27:
	LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	CMP.w #$000E
	BCC.b CODE_01DB4B
	LDA.w $6FA2,x
	AND.w #$6000
	BNE.b CODE_01DB4B
	CPX.w $61B6
	BNE.b CODE_01DB3F
	STZ.w $61B6
CODE_01DB3F:
	LDA.w #$0006
	STA.w !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
	LDA.w #$00CB
	STA.w $0B91,x
CODE_01DB4B:
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_01DB27
	LDA.w #!Define_YI_SoundID3B_Pop
	JSL.l CODE_push_sound_queue
	STZ.w !RAM_YI_Level_ItemBeingUsed
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_green_melon_item. Sets ammo type 3 (green/super) and
; falls through to CODE_melon_item_main.
;-------------------------------------------------------------------------
CODE_01DB5C:
CODE_green_melon_item:
	LDA.w #$0003
;-------------------------------------------------------------------------
; CODE_melon_item_main. Shared logic: A = ammo type,
; STA !EXRAM_YI_Level_Player_AmmoTypeInMouthLo, INC ammo-glow counters
; ($6162 / $6168), set firing-cooldown $6170 = $5A, play gulp ($14),
; clear !RAM_YI_Level_ItemBeingUsed.
;-------------------------------------------------------------------------
CODE_01DB5F:
CODE_melon_item_main:
	STA.w !EXRAM_YI_Level_Player_AmmoTypeInMouthLo|!EXRAMBankMirror
	INC.w $6162
	INC.w $6168
	LDA.w #$005A
	STA.w $6170
	LDA.w #!Define_YI_SoundID14_Gulp
	JSL.l CODE_push_sound_queue
	STZ.w !RAM_YI_Level_ItemBeingUsed
	RTS

;-------------------------------------------------------------------------
; CODE_ice_melon_item. Ammo type 4 = ice.
;-------------------------------------------------------------------------
CODE_01DB79:
CODE_ice_melon_item:
	LDA.w #$0004
	BRA.b CODE_melon_item_main

;-------------------------------------------------------------------------
; CODE_fire_melon_item. Ammo type 1 = fire.
;-------------------------------------------------------------------------
CODE_01DB7E:
CODE_fire_melon_item:
	LDA.w #$0001
	BRA.b CODE_melon_item_main

;---------------------------------------------------------------------------

CODE_01DB83:
CODE_pause_consume_inventory_slot:             ; remove the just-used item from PauseMenuItemInventory and compact the remaining slots forward, adjusting the cursor
	LDA.w !RAM_YI_Level_PauseScreenCursorLoc1
	CLC
	ADC.w !RAM_YI_Level_PauseScreenCursorLoc2
	TAX
	BEQ.b CODE_01DBB9
	STZ.w !RAM_YI_Level_PauseMenuItemInventory-$01,x
	TXY
	DEY
CODE_01DB92:
	CPX.b #$1B
	BCS.b CODE_01DBA7
	LDA.w !RAM_YI_Level_PauseMenuItemInventory,x
	AND.b #$0F
	BEQ.b CODE_01DBA4
	STA.w !RAM_YI_Level_PauseMenuItemInventory,y
	STZ.w !RAM_YI_Level_PauseMenuItemInventory,x
	INY
CODE_01DBA4:
	INX
	BRA.b CODE_01DB92

CODE_01DBA7:
	LDA.w !RAM_YI_Level_PauseScreenCursorLoc2
	BEQ.b CODE_01DBB1
	DEC.w !RAM_YI_Level_PauseScreenCursorLoc2
	BRA.b CODE_01DBB9

CODE_01DBB1:
	DEC.w !RAM_YI_Level_PauseScreenCursorLoc1
	BNE.b CODE_01DBB9
	INC.w !RAM_YI_Level_PauseScreenCursorLoc1
CODE_01DBB9:
	RTS

;---------------------------------------------------------------------------

DATA_01DBBA:
DATA_item_use_check_ptrs:                      ; 9-entry "is this item permitted right now?" table; each handler may clear ItemBeingUsed to deny use
	dw CODE_item_check_star_item,CODE_item_check_star_item,CODE_item_check_always_allow,CODE_item_check_full_egg,CODE_item_check_magnify,CODE_item_check_always_allow,CODE_item_check_watermelon,CODE_item_check_watermelon
	dw CODE_item_check_watermelon

DATA_01DBCC:
	db $01,$FF,$FF

DATA_01DBCF:
	db $03,$FF,$FF

DATA_01DBD2:
	db $1B,$FF,$FF

;-------------------------------------------------------------------------
; CODE_pause_handle_item_menu. Polls L/R for cursor scroll, A
; for item-use. On A-press, looks up !RAM_YI_Level_PauseMenuItemInventory
; at cursor position, writes to !RAM_YI_Level_ItemBeingUsed, dispatches
; via DATA_item_use_check_ptrs (9 entries: 10-star / 20-star / POW / full-egg /
; magnify / cloud / fire / ice / green melon) -- each handler decides
; whether the item is permitted (e.g. POW requires no enemies safe).
; CALLERS: CODE_pause_main.
;-------------------------------------------------------------------------
CODE_01DBD5:
CODE_pause_handle_item_menu:
	LDA.b $38
	AND.b #$03
	BEQ.b CODE_01DC4B
	TAX
	LDA.w !RAM_YI_Level_PauseScreenCursorLoc1
	BNE.b CODE_01DBE4
	JMP.w CODE_01DC8A

CODE_01DBE4:
	DEC
	STA.b $00
	CLC
	ADC.w DATA_01DBCC-$01,x
	CMP.w DATA_01DBCF-$01,x
	BEQ.b CODE_01DBFA
	INC
	STA.w !RAM_YI_Level_PauseScreenCursorLoc1
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	BRA.b CODE_01DC1C

CODE_01DBFA:
	LDA.b $00
	CLC
	ADC.w !RAM_YI_Level_PauseScreenCursorLoc2
	CLC
	ADC.w DATA_01DBCC-$01,x
	CMP.w DATA_01DBD2-$01,x
	BNE.b CODE_01DC0E
	LDA.w !RAM_YI_Level_PauseScreenCursorLoc2
	BRA.b CODE_01DC1C

CODE_01DC0E:
	LDA.b #!Define_YI_SoundID5C_ScrollTextbox
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	LDA.w !RAM_YI_Level_PauseScreenCursorLoc2
	CLC
	ADC.w DATA_01DBCC-$01,x
	STA.w !RAM_YI_Level_PauseScreenCursorLoc2
CODE_01DC1C:
	LDA.w !RAM_YI_Level_PauseScreenCursorLoc1
	CLC
	ADC.w !RAM_YI_Level_PauseScreenCursorLoc2
	TAX
	CPX.b #$1B
	BCS.b CODE_01DC42
	DEX
	LDA.w !RAM_YI_Level_PauseMenuItemInventory,x
	BNE.b CODE_01DC42
	DEC.w !RAM_YI_Level_PauseScreenCursorLoc2
	BPL.b CODE_01DC40
	STZ.w !RAM_YI_Level_PauseScreenCursorLoc2
	DEC.w !RAM_YI_Level_PauseScreenCursorLoc1
	BPL.b CODE_01DC40
	STZ.w !RAM_YI_Level_PauseScreenCursorLoc1
	BRA.b CODE_01DC42

CODE_01DC40:
	STZ.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_01DC42:
	JSR.w CODE_pause_snapshot_3_items
	JSR.w CODE_01DD8B
	JSR.w CODE_pause_draw_arrows
CODE_01DC4B:
	LDA.w !RAM_YI_Level_ItemBeingUsed
	BNE.b CODE_01DC8A
	LDA.b $37
	AND.b #$80
	BEQ.b CODE_01DC8A
	LDA.w !RAM_YI_Level_CantUseItemsFlagLo
	BNE.b CODE_01DC74
	LDA.w !RAM_YI_Level_PauseScreenCursorLoc2
	CLC
	ADC.w !RAM_YI_Level_PauseScreenCursorLoc1
	TAX
	LDA.w !RAM_YI_Level_PauseMenuItemInventory-$01,x
	STA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_01DC74
	ASL
	TAX
	REP.b #$20
	JSR.w (DATA_item_use_check_ptrs-$02,x)
	SEP.b #$20
CODE_01DC74:
	LDA.w !RAM_YI_Level_ItemBeingUsed
	BEQ.b CODE_01DC86
	LDA.b #!Define_YI_SoundID43_MountYoshi
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
	STZ.w $039A
	STZ.w $039B
	JMP.w CODE_pause_consume_inventory_slot

CODE_01DC86:
	LDA.b #!Define_YI_SoundID90_Incorrect
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_01DC8A:
	RTS

CODE_01DC8B:
CODE_item_check_star_item:                     ; star-item permission: deny if StarTimer is already at or above the soft cap
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_SoftMaxStarTimerThreshold
	BCC.b CODE_01DC96
	STZ.w !RAM_YI_Level_ItemBeingUsed
CODE_01DC96:
	RTS

CODE_01DC97:
CODE_item_check_magnify:                       ; magnifying-glass permission: deny if the hidden-items reveal flag is already set (would be a no-op)
	LDA.w !EXRAM_YI_Level_ShowHiddenItemsFlag|!EXRAMBankMirror
	BEQ.b CODE_01DC9F
	STZ.w !RAM_YI_Level_ItemBeingUsed
CODE_01DC9F:
	RTS

CODE_01DCA0:
CODE_item_check_always_allow:                  ; bare RTS: POW / enemies-to-cloud items never block
	RTS

CODE_01DCA1:
CODE_item_check_full_egg:                      ; full-egg permission: deny if Yoshi is currently in a non-normal form OR egg-count $7DF6 is already >= $0C
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	BNE.b CODE_01DCAE
	LDA.w $7DF6
	CMP.w #$000C
	BCC.b CODE_01DCB1
CODE_01DCAE:
	STZ.w !RAM_YI_Level_ItemBeingUsed
CODE_01DCB1:
	RTS

CODE_01DCB2:
CODE_item_check_watermelon:                    ; watermelon-set permission (green/fire/ice): deny if Yoshi is in non-normal form OR already has a melon active ($6162/$6168), else JSL CODE_04F74A to fire SFX
	LDA.w !EXRAM_YI_Player_CurrentFormLo|!EXRAMBankMirror
	ORA.w $6162
	ORA.w $6168
	BEQ.b CODE_01DCC1
	STZ.w !RAM_YI_Level_ItemBeingUsed
	RTS

CODE_01DCC1:
	JSL.l CODE_04F74A
	RTS

CODE_01DCC6:
CODE_pause_snapshot_3_items:                   ; copy 3 visible item-slots starting at cursor row into $0CF6..$0CF8 (used by pause_redraw_item_boxes)
	LDX.b #$00
	LDY.w !RAM_YI_Level_PauseScreenCursorLoc2
CODE_01DCCB:
	LDA.w !RAM_YI_Level_PauseMenuItemInventory,y
	STA.w $0CF6,x
	INY
	INX
	CPX.b #$03
	BCC.b CODE_01DCCB
	RTS

;---------------------------------------------------------------------------

DATA_01DCD8:
	dw $09AF,$499D

DATA_01DCDC:
	dw $09AF,$099D

CODE_01DCE0:
CODE_pause_draw_arrows:
	LDX.b #$00
	LDA.w !RAM_YI_Level_PauseScreenCursorLoc2
	BEQ.b CODE_01DCE9
	INX
	INX
CODE_01DCE9:
	REP.b #$20
	LDA.w DATA_01DCD8,x
	STA.l $7EB605
	ORA.w #$8000
	STA.l $7EB645
	SEP.b #$20
	LDX.b #$00
	LDA.w !RAM_YI_Level_PauseScreenCursorLoc2
	CLC
	ADC.b #$03
	CMP.b #$1B
	BCS.b CODE_01DD0F
	TAY
	LDA.w !RAM_YI_Level_PauseMenuItemInventory,y
	BEQ.b CODE_01DD0F
	INX
	INX
CODE_01DD0F:
	REP.b #$20
	LDA.w DATA_01DCDC,x
	STA.l $7EB61B
	ORA.w #$8000
	STA.l $7EB65B
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01DD22:
DATA_item_box_tilemap:
	dw $1DBB,$1DBC,$1DBC,$1DBE,$1DD1,$417F,$417F,$1DBF
	dw $1DD1,$417F,$417F,$1DBF,$9DBB,$9DBC,$9DBC,$9DBE

DATA_01DD42:
	dw $5DBE,$1DBC,$1DBC,$1DBE,$5DBF,$417F,$417F,$1DBF
	dw $5DBF,$417F,$417F,$1DBF,$DDBE,$9DBC,$9DBC,$9DBE

DATA_01DD62:
	dw $5DBE,$1DBC,$1DBC,$5DBB,$5DBF,$417F,$417F,$5DD1
	dw $5DBF,$417F,$417F,$5DD1,$DDBE,$9DBC,$9DBC,$DDBB

DATA_01DD82:
	dw DATA_item_box_tilemap,DATA_01DD42,DATA_01DD62

DATA_01DD88:
	db $00,$06,$0C

CODE_01DD8B:
	REP.b #$20
	PHB
	LDX.b #$7E
	PHX
	PLB
	JSR.w CODE_pause_draw_item_boxes
	PLB
	JSR.w CODE_pause_animate_item_box
	REP.b #$10
	LDY.w #$7EB59F>>16
	STY.b $01
	LDY.w #$36E0
	LDX.w #$7EB59F
	LDA.w #$0100
	JSL.l CODE_vram_dma_queue_add_180_2118
	SEP.b #$30
	RTS

CODE_01DDB0:
CODE_pause_animate_item_box:
	LDA.w !RAM_YI_Level_PauseScreenCursorLoc1
	AND.w #$00FF
	TAY
	ASL
	TAX
	LDA.w DATA_01DD88-$01,y
	TAY
	LDA.w DATA_01DD82-$02,x
	STA.b $00
	CLC
	ADC.w #$0008
	STA.b $02
	CLC
	ADC.w #$0008
	STA.b $04
	CLC
	ADC.w #$0008
	STA.b $06
	TYX
	LDY.b #$00
CODE_01DDD7:
	LDA.b ($00),y
	STA.l $7EB5C7,x
	LDA.b ($02),y
	STA.l $7EB607,x
	LDA.b ($04),y
	STA.l $7EB647,x
	LDA.b ($06),y
	STA.l $7EB687,x
	INX
	INX
	INY
	INY
	CPY.b #$08
	BCC.b CODE_01DDD7
	RTS

;---------------------------------------------------------------------------

DATA_01DDF8:
	dw $3540,$3542,$3144,$3146,$3148,$314A,$314C,$314E
	dw $334C

CODE_01DE0A:
	REP.b #$20
	LDA.w #$BFA8
	STA.b $00
	LDX.b #$00
	TXY
CODE_01DE14:
	LDA.w $0CF6,y
	AND.w #$00FF
	BEQ.b CODE_01DE3C
	PHY
	ASL
	TAY
	LDA.w DATA_01DDF8-$02,y
	STA.l $006A82,x
	PLY
	LDA.b $00
	STA.l $006A80,x
	CLC
	ADC.w #$0018
	STA.b $00
	INX
	INX
	INX
	INX
	INY
	CPY.b #$03
	BCC.b CODE_01DE14
CODE_01DE3C:
	LDA.w #$AAAA
	STA.l $006C08
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01DE46:
DATA_window_mask_settings_bg1_2:
	db $00,$02,$02,$0B,$0B,$0B,$02

DATA_01DE4D:
DATA_window_mask_settings_bg3_4_obj:
	db $00,$22,$22,$88,$88,$88,$22

;-------------------------------------------------------------------------
; CODE_message_box_handler and its alias CODE_message_box_handler_entry (without
; $10 = 1 preamble).
; See also: ys_msgdt.asm (upstream message-box / textbox handlers).
; In-level dialog/message-box state machine. Called every frame from
; CODE_gm0f_run_level when !RAM_YI_Level_MessageBoxState != 0.
;
; State byte: !RAM_YI_Level_MessageBoxState (1..15, odd values only).
; Active flag: $10 (1 = closing, 0 = opening).
;
; Sets window-mask + freezes Yoshi/sprites, then dispatches via
; DATA_message_box_state_ptr (7 entries):
;   $01 CODE_message_box_01    -- opening SFX, init counters
;   $03 CODE_message_box_03_07 -- horizontal expand sub-state (opens window
;                              by $0010 / -$0010 per frame; uses
;                              DATA_01DEF5 dispatch on $0D11)
;   $05 CODE_message_box_05    -- vertical iris-open via CODE_show_message_box (SuperFX
;                              text/icon render)
;   $07 CODE_message_box_03_07 -- closing horizontal contract
;   $09 CODE_message_box_09    -- text-display + frame-skip on button press
;   $0B CODE_message_box_0B_0D -- text-clear closing
;   $0D CODE_message_box_0B_0D -- final closing
; State $0F (terminal): clears window masks, FreezeYoshi/Sprites = 0,
; clears $038C if not in cutscene -> exits state machine.
;
; INPUTS:  $0D0F = state, $10 = direction, $0D11 = sub-substate
; OUTPUTS: Per-frame message-box anim; window masks updated;
;          freezes player when active.
; MODIFIES: A, X, Y, DB, window masks, OAM, $704070 (textbox char ptr).
; CALLERS:  CODE_gm0f_run_level + several gamemodes that show forced messages.
;-------------------------------------------------------------------------
CODE_01DE54:
CODE_message_box_handler:
	LDA.b #$01
	STA.b $10
	BRA.b CODE_01DE5C

CODE_01DE5A:
CODE_message_box_handler_entry:                ; CODE_gm0f_run_level entry: $10=0 (window-mask + freeze applied), then dispatches via DATA_message_box_state_ptr
	STZ.b $10
CODE_01DE5C:
	PHB
	PHK
	PLB
	LDX.w !RAM_YI_Level_MessageBoxState 
	LDA.b $10
	BNE.b CODE_01DE80
	TXA
	LSR
	TAY
	LDA.w DATA_window_mask_settings_bg1_2,y
	STA.w !RAM_YI_Global_BG3And4WindowMaskSettings
	LDA.w DATA_window_mask_settings_bg3_4_obj,y
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDA.b #$01
	STA.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
CODE_01DE80:
	JSR.w (DATA_message_box_state_ptr-$01,x)
	PLB
	RTL

DATA_01DE85:
DATA_message_box_state_ptr:
	dw CODE_message_box_01
	dw CODE_message_box_03_07
	dw CODE_message_box_05
	dw CODE_message_box_03_07
	dw CODE_message_box_09
	dw CODE_01DEB9
	dw CODE_01DEB9

CODE_01DE93:
CODE_message_box_01:
	LDA.b #!Define_YI_SoundID50_MessageAppears   ; SMWC tweak $01DE94: immediate byte is the sound ID. Default [$50] = message-appear chime; change for a different sound.
	JSL.l CODE_push_sound_queue
	STZ.w $0D19
	STZ.w $0D1A
	STZ.w $0D1B
CODE_01DEA2:
	INC.w !RAM_YI_Level_MessageBoxState 
	INC.w !RAM_YI_Level_MessageBoxState 
	RTS

CODE_01DEA9:
CODE_message_box_03_07:
	LDY.b #$00
	CPX.b #$03
	BNE.b CODE_01DEB3
	LDA.b $10
	BNE.b CODE_01DEC3
CODE_01DEB3:
	LDX.w $0D11
	JMP.w (DATA_01DEF5,x)

CODE_01DEB9:
CODE_message_box_0B_0D:
	LDY.b #$02
	CPX.b #$0D
	BNE.b CODE_01DEB3
	LDA.b $10
	BEQ.b CODE_01DEB3
CODE_01DEC3:
	REP.b #$20
	LDA.w $0D19
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	SEP.b #$20
	JMP.w CODE_01DF18

CODE_01DED0:
CODE_message_box_05:
	REP.b #$20
	LDA.w #$0000
	STA.l $70406E
	SEP.b #$20
	JSR.w CODE_show_message_box
	BRA.b CODE_01DEA2

CODE_01DEE0:
CODE_message_box_09:
	JSR.w CODE_show_message_box
	LDA.l $70406E
	CMP.b #$02
	BCC.b CODE_01DEF4
	LDA.b #!Define_YI_SoundID56_ThunderLakituAttacking6
	JSL.l CODE_push_sound_queue
	JSR.w CODE_01DEA2
CODE_01DEF4:
	RTS

DATA_01DEF5:
	dw CODE_01DEFF

DATA_01DEF7:
	dw $0100,$0000

DATA_01DEFB:
	dw $0010,$FFF0

CODE_01DEFF:
	REP.b #$20
	LDA.w $0D19
	CLC
	ADC.w DATA_01DEFB,y
	STA.w $0D19
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	CMP.w DATA_01DEF7,y
	SEP.b #$20
	BEQ.b CODE_01DF18
	JMP.w CODE_01E048

CODE_01DF18:
	JSR.w CODE_01DEA2
	LDA.w !RAM_YI_Level_MessageBoxState 
	CMP.b #$0F
	BNE.b CODE_01DF45
	STZ.w !RAM_YI_Level_MessageBoxState 
	LDA.b $10
	BNE.b CODE_01DF44
	STZ.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STZ.w !RAM_YI_Global_BG3And4WindowMaskSettings
	STZ.w !RAM_YI_Global_ObjectAndColorWindowSettings
	STZ.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	LDA.w $038C
	BEQ.b CODE_01DF41
	BIT.b $35
	BVS.b CODE_01DF44
	STZ.w $038C
CODE_01DF41:
	STZ.w !EXRAM_YI_Level_FreezeYoshiFlagLo|!EXRAMBankMirror
CODE_01DF44:
	RTS

CODE_01DF45:
	CMP.b #$0D
	BNE.b CODE_01DF8E
	REP.b #$30
	LDA.w #$0100
	STA.w $0D19
	LDY.w #$0180
	LDA.w $0D17
	CLC
	ADC.w #$00C0
	CMP.w #$3800
	BEQ.b CODE_01DF6A
	BCC.b CODE_01DF6A
	LDA.w #$3800
	SBC.w $0D17
	ASL
	TAY
CODE_01DF6A:
	LDA.w $0D17
	JSR.w CODE_01D533
	REP.b #$30
	LDA.w $0D17
	CLC
	ADC.w #$00C0
	SEC
	SBC.w #$3800
	BEQ.b CODE_01DF89
	BMI.b CODE_01DF89
	ASL
	TAY
	LDA.w #$3400
	JSR.w CODE_01D533
CODE_01DF89:
	SEP.b #$30
CODE_01DF8B:
	JMP.w CODE_01E048

CODE_01DF8E:
	CMP.b #$05
	BNE.b CODE_01DF8B
	REP.b #$30
	STZ.w $0D19
	LDY.w #$0182
	LDA.b !RAM_YI_Global_Layer3YPosLo
	CLC
	ADC.w #$0018
	AND.w #$01F0
	ASL
	ORA.w #$3400
	STA.w $0D17
	CLC
	ADC.w #$00C0
	CMP.w #$3800
	BEQ.b CODE_01DFBF
	BCC.b CODE_01DFBF
	LDA.w #$3800
	SBC.w $0D17
	ASL
	INC
	INC
	TAY
CODE_01DFBF:
	LDA.w $0D17
	ORA.w #$8000
	JSR.w CODE_01D533
	REP.b #$30
	LDA.w $0D17
	CLC
	ADC.w #$00C0
	SEC
	SBC.w #$3800
	BEQ.b CODE_01DFE3
	BMI.b CODE_01DFE3
	ASL
	INC
	INC
	TAY
	LDA.w #$B400
	JSR.w CODE_01D533
CODE_01DFE3:
	SEP.b #$30
	PHB
	LDA.b #$7E4002>>16
	PHA
	PLB
	REP.b #$30
	LDA.b !RAM_YI_Global_Layer3XPosLo
	CLC
	ADC.w #$0038
	AND.w #$01F0
	LSR
	LSR
	LSR
	LSR
	STA.b $02
	EOR.w #$001F
	INC
	CMP.w #$000A
	BCC.b CODE_01E007
	LDA.w #$000A
CODE_01E007:
	STA.b $04
	STZ.b $08
	LDA.w #$2A00
	STA.b $06
	LDA.l $000D17
	CLC
	ADC.b $02
	STA.b $02
	JSR.w CODE_01E0BF
	INC.b $08
	LDA.b $04
	CMP.w #$000A
	BCS.b CODE_01E03F
	DEC
	ASL
	CLC
	ADC.w #$2A00
	STA.b $06
	LDA.w #$000A
	SEC
	SBC.b $04
	STA.b $04
	LDA.b $02
	AND.w #$FFE0
	STA.b $02
	JSR.w CODE_01E0BF
CODE_01E03F:
	LDA.w #$FFFF
	STA.w $7E4002,x
	SEP.b #$30
	PLB
CODE_01E048:
	REP.b #$20
	STZ.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	STZ.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	STZ.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.b !RAM_YI_Global_Layer3XPosLo
	AND.w #$000F
	CMP.w #$0008
	BCS.b CODE_01E060
	ORA.w #$0010
CODE_01E060:
	EOR.w #$FFFF
	INC
	CLC
	ADC.w #$0090
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.b !RAM_YI_Global_Layer3YPosLo
	AND.w #$000F
	CMP.w #$0008
	BCS.b CODE_01E078
	ORA.w #$0010
CODE_01E078:
	EOR.w #$FFFF
	INC
	CLC
	ADC.w #$0047
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w #FXCODE_088002
	LDX.b $10
	BEQ.b CODE_01E08D
	LDA.w #FXCODE_088040
CODE_01E08D:
	LDX.b #FXCODE_088002>>16
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	LDA.b $10
	BNE.b CODE_01E0BE
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.w !RAM_YI_Global_MainScreenWindowMask
	LDA.w !RAM_YI_Global_SubScreenLayers
	STA.w !RAM_YI_Global_SubScreenWindowMask
	LDA.b #$30
	STA.w !RAM_YI_Global_BGWindowLogicSettings
	STZ.w !REGISTER_ColorAndObjectWindowLogicSettings
	LDA.b #$20
	TSB.w !RAM_YI_Global_HDMAEnable
CODE_01E0BE:
	RTS

CODE_01E0BF:
	LDA.w #$0006
	STA.b $00
	LDX.w $4000
	LDA.b $02
CODE_01E0C9:
	STA.w $4002,x
	PHA
	LDA.b $04
	ASL
	DEC
	STA.w $4004,x
	LDA.b $00
	DEC
	BEQ.b CODE_01E0EB
	CMP.w #$0005
	BCS.b CODE_01E0EB
	JSR.w CODE_01E107
	LDA.b $06
	CLC
	ADC.w #$0020
	STA.b $06
	BRA.b CODE_01E0EE

CODE_01E0EB:
	JSR.w CODE_01E136
CODE_01E0EE:
	TXA
	CLC
	ADC.w #$0004
	TAX
	PLA
	CLC
	ADC.w #$0020
	AND.w #$F7FF
	ORA.w #$0400
	DEC.b $00
	BNE.b CODE_01E0C9
	STX.w $4000
	RTS

CODE_01E107:
	LDY.b $04
	LDA.b $08
	BNE.b CODE_01E118
	LDA.w #$2DC3
	STA.w $4006,x
	INX
	INX
	DEY
	BEQ.b CODE_01E135
CODE_01E118:
	LDA.b $06
CODE_01E11A:
	STA.w $4006,x
	INC
	INC
	INX
	INX
	DEY
	BNE.b CODE_01E11A
	LDA.b $08
	BNE.b CODE_01E12F
	LDA.b $04
	CMP.w #$000A
	BCC.b CODE_01E135
CODE_01E12F:
	LDA.w #$6DC3
	STA.w $4004,x
CODE_01E135:
	RTS

CODE_01E136:
	LDY.b $04
	LDA.b $08
	BNE.b CODE_01E151
	LDA.b $00
	DEC
	BNE.b CODE_01E146
	LDA.w #$ADC0
CODE_01E144:
	BRA.b CODE_01E149

CODE_01E146:
	LDA.w #$2DC0
CODE_01E149:
	STA.w $4006,x
	INX
	INX
	DEY
	BEQ.b CODE_01E17F
CODE_01E151:
	LDA.b $00
	DEC
	BNE.b CODE_01E15B
	LDA.w #$ADC1
	BRA.b CODE_01E15E

CODE_01E15B:
	LDA.w #$2DC1
CODE_01E15E:
	STA.w $4006,x
	INX
	INX
	DEY
	BNE.b CODE_01E15E
	LDA.b $08
	BNE.b CODE_01E171
	LDA.b $04
	CMP.w #$000A
	BCC.b CODE_01E17F
CODE_01E171:
	LDA.w #$6DC0
	LDY.b $00
	DEY
	BNE.b CODE_01E17C
	LDA.w #$EDC0
CODE_01E17C:
	STA.w $4004,x
CODE_01E17F:
	RTS

;---------------------------------------------------------------------------

CODE_01E180:
CODE_show_message_box:                      ; load message by ID ($704070) -> hand off to GSU renderer FXCODE_09B03E; see docs/mchip.md 3.18
	LDA.w $012D
	PHA
	LDA.w $012E
	PHA
	LDA.b #$13
	STA.w $012D
	LDA.b #!SuperFX_ScreenMode_ScreenHeight_128pixels|!SuperFX_ScreenMode_ColorMode_16Colors|!SuperFX_ScreenMode_SuperFXHasWRAMAccess|!SuperFX_ScreenMode_SuperFXHasROMAccess|!SuperFX_ScreenMode_ColorMode_Unused
	STA.w $012E
	REP.b #$30
	LDA.l $704070
	ASL
	TAX
	LDA.l FXDATA_5110DB,x
	STA.l $704096
	LDA.w #FXDATA_5110DB>>16
	STA.l $704098
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	STA.l $70409A
	SEP.b #$10
	LDA.w #$0000
	STA.l $704074
	STA.l $704076
	LDA.w $0071
	BNE.b CODE_01E1D6
	LDA.w $093C
	AND.w #$0F80
	STA.l $704074
	LDA.w $093E
	AND.w #$0F80
	STA.l $704076
CODE_01E1D6:
	LDX.b #FXCODE_09B03E>>16
	LDA.w #FXCODE_09B03E
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	PLA
	STA.w $012E
	PLA
	STA.w $012D
	LDA.w $607A
	BEQ.b CODE_01E1F2
	JSL.l CODE_push_sound_queue
CODE_01E1F2:
	INC.w $0D15
	JSR.w CODE_01E1F9
	RTS

CODE_01E1F9:
	PHB
	LDA.b #$7E4000>>16
	PHA
	PLB
	REP.b #$30
	LDX.w $7E4000
	LDA.b !RAM_YI_Global_Layer3YPosLo
	CLC
	ADC.w #$0068
	AND.w #$01F0
	ASL
	ORA.w #$3400
	STA.b $00
	LDA.b !RAM_YI_Global_Layer3XPosLo
	CLC
	ADC.w #$00B8
	AND.w #$01F0
	LSR
	LSR
	LSR
	LSR
	ADC.b $00
	STA.w $7E4002,x
	LDA.w #$0001
	STA.w $7E4004,x
	LDA.l $704073
	AND.w #$00FF
	CMP.w #$000F
	BEQ.b CODE_01E250
	CMP.w #$0051
	BEQ.b CODE_01E250
	CMP.w #$00FF
	BEQ.b CODE_01E250
	LDA.l $70406E
	CMP.w #$0002
	BCS.b CODE_01E250
	LDA.b $30
	AND.w #$0010
	BEQ.b CODE_01E255
CODE_01E250:
	LDA.w #$ADC1
	BRA.b CODE_01E258

CODE_01E255:
	LDA.w #$2DC5
CODE_01E258:
	STA.w $7E4006,x
	LDA.w #$FFFF
	STA.w $7E4008,x
	TXA
	CLC
	ADC.w #$0006
	STA.w $7E4000
	SEP.b #$30
	PLB
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_gm31_fade_to_score_from_boss.
; GAMEMODE $31 entry: post-boss fade-to-score sub-state machine.
; Dispatches via $0B57 (state, doubled into X) into DATA_gm31_score_state_ptrs
; (11 entries: $00 init, $02 expand, $04 score-screen content, $06
; tally line, $08 stars, $0A coins, $0C flowers, $0E score, $10 high-
; score, $12 expand back, $14 finalise).
; When $0B57 reaches $16, sets gamemode to $10 and $0B57 = $19.
; Calls JSL CODE_gm0f_core_init only while $0B57 < 8 (initial setup phase).
;-------------------------------------------------------------------------
CODE_01E26D:
CODE_gm31_fade_to_score_from_boss:
	LDX.w $0B57
	JSR.w (DATA_gm31_score_state_ptrs,x)
	LDA.w $0B57
	CMP.b #$16
	BCC.b CODE_01E284
	LDA.b #$19
	STA.w $0B57
	LDA.b #!Define_YI_GameMode10
	STA.w !RAM_YI_Global_CurrentGameMode
CODE_01E284:
	LDA.w $0B57
	CMP.b #$08
	BCS.b CODE_01E28F
	JSL.l CODE_gm0f_core_init
CODE_01E28F:
	PLB
	RTL

DATA_01E291:
DATA_gm31_score_state_ptrs:                    ; 11-entry score-screen "fade in from boss" state table for gamemode $31; states $0-$5 are setup, $6-$9 share victory-cutscene routines for the score-screen reveal
	dw CODE_gm31_state_init_backdrop
	dw CODE_gm31_state_expand_window
	dw CODE_gm31_state_shrink_window
	dw CODE_gm31_state_setup_score_bg
	dw CODE_victory_init_score_tilemap
	dw CODE_01B6B9
	dw CODE_01B6C9
	dw CODE_01B95B
	dw CODE_01B9BA
	dw CODE_gm31_state_expand_window
	dw CODE_gm31_state_finalise_window

CODE_01E2A7:
CODE_gm31_state_init_backdrop:                 ; gm31 state $00: snapshot palette-mirror row 0 -> $0948 backdrop mirror (skip if Raphael mode), then fill window-mask staging at $70:3A02 with $FF00 (full transparency)
	REP.b #$30
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$0009
	BEQ.b CODE_01E2C1
	LDA.l YI_Global_PaletteMirror[$00].LowByte
	STA.w $0948
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$00].LowByte
CODE_01E2BF:
	REP.b #$30
CODE_01E2C1:
	LDX.w #$0000
	LDA.w #$FF00
CODE_01E2C7:
	STA.l $703A02,x
	INX
	INX
	INX
	INX
	CPX.w #$0348
	BCC.b CODE_01E2C7
	SEP.b #$30
	INC.w $0B57
	INC.w $0B57
	STZ.w $0D1F
	RTS

DATA_01E2E0:
	dw $1F1F,$0104

DATA_01E2E4:
	dw $0000,$018C

DATA_01E2E8:
	dw $0350,$018C

DATA_01E2EC:
	dw $FF00,$9F60

CODE_01E2F0:
CODE_gm31_state_expand_window:                 ; gm31 state $01: every frame DMA one 0xD2-byte slice of window-mask data (via CODE_queue_dma_4args) to $7E:56D0/57A2/5874/5946 staging; after 10 frames advance state and set up HDMA + color-math
	INC.w $0D1F
	LDA.w $0D1F
	CMP.b #$0A
	BCC.b CODE_01E338
	INC.w $0B57
	INC.w $0B57
	REP.b #$20
	STZ.w $0D1F
	LDX.w $0B4E
	LDA.w DATA_01E2E0,x
	STA.w !RAM_YI_Global_MainScreenWindowMask
	LDA.w DATA_01E2E4,x
	STA.w $0D23
	LDA.w DATA_01E2E8,x
	STA.w $0D25
	LDA.w DATA_01E2EC,x
	STA.w $0D21
	SEP.b #$20
	LDA.b #$33
	STA.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STA.w !RAM_YI_Global_BG3And4WindowMaskSettings
	STA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	LDA.b #$22
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$20
	STA.w !RAM_YI_Global_HDMAEnable
	RTS

CODE_01E338:
	DEC
	BNE.b CODE_01E348
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $00D2
	RTS

CODE_01E348:
	DEC
	BNE.b CODE_01E358
	JSL.l CODE_queue_dma_4args	: dl $7E57A2,$703AD4 : dw $00D2
	RTS

CODE_01E358:
	DEC
	BNE.b CODE_01E368
	JSL.l CODE_queue_dma_4args	: dl $7E5874,$703BA6 : dw $00D2
	RTS

CODE_01E368:
	DEC
	BNE.b CODE_01E377
	JSL.l CODE_queue_dma_4args	: dl $7E5946,$703C78 : dw $00D2
CODE_01E377:
	RTS

CODE_01E378:
CODE_gm31_state_shrink_window:                 ; gm31 state $02: shrink/expand window-mask via DATA_01E3A7/01E3AB deltas; when range below 8 px, advance state and re-init palette via CODE_clear_all_sprites + CODE_init_oam_buffer
	JSR.w CODE_gm31_paint_window_mask
	REP.b #$20
	LDA.w $0D25
	SEC
	SBC.w $0D23
	CMP.w #$0008
	BCS.b CODE_01E3A4
	INC.w $0B4E
	INC.w $0B4E
	INC.w $0B57
	INC.w $0B57
	JSL.l CODE_clear_all_sprites
	JSL.l CODE_init_oam_buffer
	SEP.b #$20
	LDA.b #$20
	STA.w !RAM_YI_Global_HDMAEnable
CODE_01E3A4:
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01E3A7:
	dw $0008,$FFF8

DATA_01E3AB:
	dw $0002,$FFFE

CODE_01E3AF:
CODE_gm31_paint_window_mask:                   ; build $70:3A02 window-mask staging from $0D23/$0D25 (left/right edges) and $0D21 (fill byte); shrinks bounds each frame by DATA_01E3A7/01E3AB
	REP.b #$30
	LDA.w $0B4E
	AND.w #$0002
	TAY
	LDX.w #$0000
	LDA.w #$00FF
CODE_01E3BE:
	CPX.w $0D23
	BCS.b CODE_01E3CD
	STA.l $703A02,x
	INX
	INX
	INX
	INX
	BRA.b CODE_01E3BE

CODE_01E3CD:
	LDA.w $0D21
CODE_01E3D0:
	CPX.w $0D25
	BCS.b CODE_01E3DF
	STA.l $703A02,x
	INX
	INX
	INX
	INX
	BRA.b CODE_01E3D0

CODE_01E3DF:
	LDA.w #$00FF
CODE_01E3E2:
	CPX.w #$0348
	BCS.b CODE_01E3F1
	STA.l $703A02,x
	INX
	INX
	INX
	INX
	BRA.b CODE_01E3E2

CODE_01E3F1:
	LDA.w #$FF00
CODE_01E3F4:
	CPX.w #$0348
	BCS.b CODE_01E403
	STA.l $703A02,x
	INX
	INX
	INX
	INX
	BRA.b CODE_01E3F4

CODE_01E403:
	LDA.w $0D23
	CLC
	ADC.w DATA_01E3A7,y
	STA.w $0D23
	LDA.w $0D25
	SEC
	SBC.w DATA_01E3A7,y
	STA.w $0D25
	SEP.b #$30
	LDA.w $0D21
	CLC
	ADC.w DATA_01E3AB,y
	STA.w $0D21
	LDA.w $0D22
	SEC
	SBC.w DATA_01E3AB,y
	STA.w $0D22
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	LDA.w !RAM_YI_Global_HDMAEnable
	ORA.b #$20
	STA.w !RAM_YI_Global_HDMAEnable
	RTS

CODE_01E442:
CODE_gm31_state_setup_score_bg:                ; gm31 state $03: blank-fill the entire window-mask staging (>$0348 bytes of $00FF), then switch BGModeAndTileSize to mode 1 (BG1+BG3 only); init scroll mirrors to 0; advance state
	REP.b #$30
	LDX.w #$0000
	LDA.w #$00FF
CODE_01E44A:
	STA.l $703A02,x
	INX
	INX
	INX
	INX
	CPX.w #$0348
	BCC.b CODE_01E44A
	SEP.b #$30
	JSL.l CODE_queue_dma_4args	: dl $7E56D0,$703A02 : dw $0348
	LDA.b #$09
	STA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	LDA.b #$69
	STA.w !RAM_YI_Global_BG1AddressAndSize
	LDA.b #$34
	STA.w !RAM_YI_Global_BG3AddressAndSize
	LDA.b #$02
	STA.w $011C
	LDA.b #$20
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	REP.b #$20
	STZ.w $0D2D
	STZ.w $0D2B
	STZ.w $61CA
	LDA.w #$0277
	STA.w !RAM_YI_Global_BG1And2TileDataDesignation
	STZ.b !RAM_YI_Global_Layer1XPosLo
	STZ.b !RAM_YI_Global_Layer1YPosLo
	STZ.b !RAM_YI_Global_Layer3XPosLo
	STZ.b !RAM_YI_Global_Layer3YPosLo
	SEP.b #$20
	INC.w $0B57
	INC.w $0B57
	RTS

;---------------------------------------------------------------------------

CODE_01E4A0:
CODE_gm31_state_finalise_window:               ; gm31 state $0A: shrink window mask until $0D23 negative (fully open), then zero per-stage counters ($0392/$0B5F/$0B61/$0B63/$0381) and arm 0x30-frame settle timer
	JSR.w CODE_gm31_paint_window_mask
	REP.b #$20
	LDA.w $0D23
	BPL.b CODE_01E4D1
	INC.w $0B57
	INC.w $0B57
	STZ.w $0392
	STZ.w $0B5F
	STZ.w $0B61
	STZ.w $0B63
	STZ.w $0381
	STZ.w !RAM_YI_Global_MainScreenWindowMask
	STZ.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STZ.w !RAM_YI_Global_BG3And4WindowMaskSettings
	SEP.b #$20
	LDA.b #$30
	STA.w $038B
	REP.b #$20
CODE_01E4D1:
	SEP.b #$20
	LDA.b #$20
	STA.w !RAM_YI_Global_HDMAEnable
	RTS

;---------------------------------------------------------------------------

DATA_01E4D9:
	dw $03C0,$0440,$04C0,$0540

DATA_01E4E1:
	dw $8000,$4000,$2000,$1000,$0800,$0400,$0200,$0100
	dw $0080,$0040,$0020,$0010,$0008,$0004,$0002,$0001

CODE_01E501:
CODE_item_memory_bit_lookup:                   ; JSL helper: returns nonzero in A if the item-memory bit indexed by X is set in the save-RAM bitmap at $03C0/0440/04C0/0540 (selected by ItemMemorySetting)
	PHX
	TXA
	AND.w #$001E
	TAX
	LDA.l DATA_01E4E1,x
	STA.b $02
	LDA.w !RAM_YI_Level_LevelHeaderItemMemorySettingLo
	ASL
	TAX
	LDA.l DATA_01E4D9,x
	STA.b $00
	PLX
	LDA.b $1B
	XBA
	AND.w #$00FF
	TAY
	LDA.w $6CAA,y
	AND.w #$003F
	ASL
	TAY
	LDA.b ($00),y
	AND.b $02
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_gm33_fade_to_midring_restart_screen.
; GAMEMODE $33 entry: fade from in-level to the "restart from midring?"
; prompt screen. Calls $008277 / $00831C (init/clear), sets text-char-
; ptr $704070 = $2E (the "RESTART FROM MID-RING?" prompt), runs
; CODE_retry_setup_shared (shared setup), JML to Bank10 dispatcher tail.
;-------------------------------------------------------------------------
CODE_01E52D:
CODE_gm33_fade_to_midring_restart_screen:
	JSL.l CODE_init_oam_and_bg3_tilemap
	JSL.l CODE_clear_basic_states
	LDA.b #$2E
	STA.l $704070
	JSR.w CODE_retry_setup_shared
	JML.l CODE_increment_gamemode

;---------------------------------------------------------------------------

DATA_01E542:
	dw $3400,$47FF,$2A6E
	dw $3485,$000F,$2A00
	dw $2A02,$2A04,$2A06
	dw $2A08,$2A0A,$2A0C
	dw $2A0E,$34A5,$000F
	dw $2A20,$2A22,$2A24
	dw $2A26,$2A28,$2A2A
	dw $2A2C,$2A2E,$34C5
	dw $000F,$2A40,$2A42
	dw $2A44,$2A46,$2A48
	dw $2A4A,$2A4C,$2A4E
	dw $34E5,$000F,$2A60
	dw $2A62,$2A64,$2A66
	dw $2A68,$2A6A,$2A6C
	dw $2A6E,$FFFF

;---------------------------------------------------------------------------

CODE_01E59A:
CODE_retry_setup_shared:                       ; shared setup for gm33/gm3B/gm3D retry-prompt screens: init palette / OAM, run scene-mode 0, zero CGRAM mirror, load BG3 tilemap via $1E queue index, arm IRQ
	JSL.l CODE_clear_all_sprites
	JSL.l CODE_init_oam_buffer
	LDX.w DATA_levelmode_index
	JSL.l CODE_init_scene_regs
	LDX.b #$702000>>16
	PHX
	PLB
	REP.b #$20
	LDX.b #$7E
CODE_01E5B1:
	STZ.w $702000,x
	STZ.w $702080,x
	STZ.w $702100,x
	STZ.w $702180,x
	DEX
	DEX
	BPL.b CODE_01E5B1
	LDA.w #$7FFF
	STA.w $702016
	SEP.b #$20
	PHK
	PLB
	LDA.b #$1E
	STA.w $0127
	JSL.l CODE_prepare_tilemap_dma_queue_l
	JSR.w CODE_retry_screen_per_frame
	LDA.b #$02
	STA.w $0125
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$D8
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_gm35_load_restart_from_midring.
; GAMEMODE $35 entry: loop reading the midring restart prompt; on Yes
; ($0037 & $80 -- A button), advances gamemode, sets $038C = 1 (restart
; flag), restores high-score / progress from save RAM via $7F:7E00..03
; population, then re-enters level via gm0c with $038C set so the
; level-load path takes the midring-restart branch.
;-------------------------------------------------------------------------
CODE_01E5E9:
CODE_gm35_load_restart_from_midring:
	LDA.b #$2E
	STA.l $704070
	JSR.w CODE_retry_screen_per_frame
	LDA.w $0037
	AND.b #$80
	ORA.w $0038
	AND.b #$90
	BNE.b CODE_01E601
	JMP.w CODE_01E687

CODE_01E601:
	LDA.w $0037
	AND.b #$80
	BNE.b CODE_01E612
	LDA.l $704094
	TAX
	LDA.w DATA_try_again_sounds,x
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_01E612:
	LDA.b #$10
	STA.b $8F
	INC.w !RAM_YI_Global_CurrentGameMode
	STZ.w $038C
	TXA
	BNE.b CODE_01E687
	LDA.b #$01
	STA.w $038C
	JSR.w CODE_restore_midring_inventory
	REP.b #$20
	STZ.w !EXRAM_YI_Level_ShowHiddenItemsFlag|!EXRAMBankMirror
	STZ.w $03A1
	STZ.w $03A3
	STZ.w $03A5
	LDA.w !RAM_YI_Level_StarTimerLo
CODE_01E638:
	CMP.w #$0064
	BCC.b CODE_01E645
	SBC.w #$0064
	INC.w $03A1
	BRA.b CODE_01E638

CODE_01E645:
	CMP.w #$000A
	BCC.b CODE_01E652
	SBC.w #$000A
	INC.w $03A3
	BRA.b CODE_01E645

CODE_01E652:
	STA.w $03A5
	PHB
	LDY.b #YI_LevelDataPtrsAndEntranceData_DATA_17F551>>16
	PHY
	PLB
	REP.b #$30
	STZ.w $038E
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo	; tile-slot (translevel)
	ASL
	TAY
	LDA.w !RAM_YI_Level_CheckpointReentryPageLo	; checkpoint page selects the sub-record
	ASL
	ASL
	ADC.w YI_LevelDataPtrsAndEntranceData_DATA_17F551,y	; midway index base + page x4 -> record offset
	TAY
	LDA.w YI_LevelDataPtrsAndEntranceData_DATA_17F5DB+$01,y	; 16-bit: bytes +1/+2 = entrance X/Y
	STA.l $7F7E01						;   -> live exit table $7F7E01 (X) + $7F7E02 (Y)
	SEP.b #$20
	LDA.w YI_LevelDataPtrsAndEntranceData_DATA_17F5DB,y	; byte +0 = level-data ID (Ptrs key)
	STA.l $7F7E00
	LDA.w YI_LevelDataPtrsAndEntranceData_DATA_17F5DB+$03,y	; byte +3 = player entrance-state
	STA.l $7F7E03
	SEP.b #$10
	PLB
CODE_01E687:
	PLB
	RTL

CODE_01E689:
CODE_retry_screen_per_frame:                   ; per-frame retry-screen tick: run text-box update (CODE_show_message_box), then reset $7E:4000/4002 (tilemap-queue head + sentinel) for the next frame
	JSR.w CODE_show_message_box
	LDA.l $704094
	TAX
	REP.b #$30
	LDA.w #$0000
	STA.l $7E4000
	DEC
	STA.l $7E4002
	SEP.b #$30
	RTS

;-------------------------------------------------------------------------
; CODE_gm3b_load_retry_screen. GAMEMODE $3B entry: shows
; "TRY AGAIN?" prompt screen ($704070 = $21 = retry-prompt char).
;-------------------------------------------------------------------------
CODE_01E6A2:
CODE_gm3b_load_retry_screen:
	JSL.l CODE_init_oam_and_bg3_tilemap
	JSL.l CODE_clear_basic_states
	LDA.b #$21
	STA.l $704070
	JSR.w CODE_retry_setup_shared
	JML.l CODE_increment_gamemode

DATA_01E6B7:
DATA_try_again_sounds:
	db !Define_YI_SoundID43_MountYoshi,!Define_YI_SoundID2E_ClankSound7

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_gm3d_retry_screen. GAMEMODE $3D: poll for Yes/No on the
; retry-prompt; on input, plays "mount" or "clank" SFX, sets game-
; mode advance flag $8F = $10.
;-------------------------------------------------------------------------
CODE_01E6B9:
CODE_gm3d_retry_screen:
	LDA.b #$21
	STA.l $704070
	JSR.w CODE_retry_screen_per_frame
	LDA.w $0037
	AND.b #$80
	ORA.w $0038
	AND.b #$90
	BEQ.b CODE_01E6EC
	LDA.w $0037
	AND.b #$80
	BNE.b CODE_01E6DF
	LDA.l $704094
	TAX
	LDA.w DATA_try_again_sounds,x
	STA.b !RAM_YI_Global_PlaySoundHighPriorityLo
CODE_01E6DF:
	INC.w !RAM_YI_Global_CurrentGameMode
	LDA.b #$10
	STA.b $8F
	TXA
	BNE.b CODE_01E6EC
	STZ.w $038C
CODE_01E6EC:
	PLB
	RTL

;---------------------------------------------------------------------------

DATA_01E6EE:
	db !Define_YI_GameMode0B,!Define_YI_GameMode1F

;-------------------------------------------------------------------------
; CODE_gm_retry_level_cutscene_select. After retry/no choice,
; DEC $8F (delay); when 0, sets gamemode to either $0B (death cutscene)
; or $1F (try-again screen) per DATA_01E6EE[$704094]. Handles the
; level-0 (Welcome To Yoshi's Island) special-case to reset
; CurrentLevelFromMapLo.
;-------------------------------------------------------------------------
CODE_01E6F0:
CODE_gm_retry_level_cutscene_select:
	DEC.b $8F
	BNE.b CODE_01E70F
	LDA.l $704094
	TAX
	LDA.w DATA_01E6EE,x
	STA.w !RAM_YI_Global_CurrentGameMode
	DEX
	BMI.b CODE_01E70C
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.b #!Define_YI_LevelID_WelcomeToYoshisIsland
	BNE.b CODE_01E70C
	STZ.w !RAM_YI_Level_CurrentLevelFromMapLo
CODE_01E70C:
	STZ.w $0203
CODE_01E70F:
	PLB
	RTL

;---------------------------------------------------------------------------

DATA_01E711:
DATA_bg2_tilemap_indices:
	dw $0000,$0002,$0004,$0006,$0008,$000A,$003D,$003F
	dw $0041,$0043,$0045,$0047,$0049,$004B,$004D,$004F
	dw $0087,$0089,$008B,$008D,$0099,$009B,$009D,$009F
	dw $009F,$00A1,$00A3,$00A5,$00A7,$00AB,$00AD,$00AF

DATA_01E751:
DATA_bg2_tilemap_gfx_entries:
	db $00,$BE,$00,$BF,$00,$C0,$00,$C1,$00,$C2,$04,$C3,$01,$00 : dw DATA_01E761

DATA_01E761:
	db $00,$B0,$00,$F7,$02,$00,$A0,$00,$07,$03,$00,$90,$00,$17,$03,$00
	db $80,$00,$27,$03,$00,$70,$00,$37,$03,$00,$60,$00,$47,$03,$00,$50
	db $00,$57,$03,$00,$40,$00,$67,$03,$00,$C0,$00,$00,$08,$00,$C4,$00
	db $C5,$00,$C6,$00,$CD,$00,$C7,$00,$C8,$00,$C9,$00,$CA,$00,$CB,$04
	db $CC,$01,$00 : dw DATA_01E7A6

DATA_01E7A6:
	db $00,$28,$00,$97,$01,$00,$16,$00,$B7,$01,$00,$28,$00,$D7,$01,$00
	db $16,$00,$F7,$01,$00,$28,$00,$17,$02,$00,$16,$00,$37,$02,$00,$28
	db $00,$57,$02,$00,$28,$00,$77,$02,$00,$40,$00,$B7,$02,$00,$80,$00
	db $00,$04,$00,$CD,$00,$CC,$00,$CE,$00,$CF,$01,$02,$C7,$02,$04,$57
	db $03,$02,$00,$04,$00,$D0,$00,$D1,$00,$D7,$00,$D2,$00,$D3,$00,$D4
	db $00,$D5,$04,$D6,$00,$00,$00,$D9,$00,$DA,$00,$DB,$00,$76,$00,$6E
	db $00,$66,$00,$5E

;-------------------------------------------------------------------------
; CODE_load_bg2_tilemap. Called from gm0c.
; Decompresses the level's BG2 tilemap into VRAM $3800 (size from
; DATA_bg2_tilemap_gfx_entries). Special-cases:
;   - LevelMode $0A (Bowser-room): JMP CODE_01E88F (different load path).
;   - LevelMode $03 (cinema cutscene): JSR CODE_01E8D1 (BG2-anim init).
; Uses DATA_bg2_tilemap_indices (32 entries) to map BG2 tileset ID -> DATA_bg2_tilemap_gfx_entries
; entry offset; DATA_bg2_tilemap_subhandler_ptrs has 3 sub-handler dispatch entries based
; on entry-type byte.
;-------------------------------------------------------------------------
CODE_01E80A:
CODE_load_bg2_tilemap:
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.b #$0A
	BNE.b CODE_01E814
	JMP.w CODE_01E88F

CODE_01E814:
	STZ.w $0D2B
	STZ.w $0D2D
	STZ.w $0D37
	STZ.w $0D39
	REP.b #$30
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	ASL
	TAX
	LDY.w DATA_bg2_tilemap_indices,x
	LDA.w DATA_bg2_tilemap_gfx_entries,y
	AND.w #$00FF
	TAX
	JMP.w (DATA_bg2_tilemap_subhandler_ptrs,x)

DATA_01E834:
DATA_bg2_tilemap_subhandler_ptrs:              ; 3-entry sub-handler dispatch by entry-type byte: $00 plain, $02 unused, $04 wavy-with-HDMA
	dw CODE_01E84F
	dw $0000
	dw CODE_load_bg2_tilemap_wavy

CODE_01E83A:
CODE_load_bg2_tilemap_wavy:                    ; entry-type $04 sub-handler: arm BG2 horizontal-scroll HDMA channel 4 with wavy parameters from DATA_bg2_tilemap_gfx_entries+$02/+$04 before the standard tilemap decompress
	SEP.b #$20
	LDA.b #!REGISTER_BG2HorizScrollOffset
	STA.w HDMA[$04].Destination
	LDA.w DATA_bg2_tilemap_gfx_entries+$02,y
	STA.w $0D2B
	REP.b #$20
	LDA.w DATA_bg2_tilemap_gfx_entries+$04,y
	STA.w $0D2F
CODE_01E84F:
	LDA.w DATA_bg2_tilemap_gfx_entries+$01,y
	AND.w #$00FF
	LDX.w #$5800
	JSL.l CODE_00B756
	STA.w DMA[$00].SizeLo
	SEP.b #$10
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$3800
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDX.b #$705800>>16
	STX.w DMA[$00].SourceBank
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	SEP.b #$20
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.b #$03
	BNE.b CODE_01E88E
	JSR.w CODE_01E8D1
CODE_01E88E:
	RTS

CODE_01E88F:
	REP.b #$30
	LDA.w #$00F2
	AND.w #$00FF
	LDX.w #$5800
	JSL.l CODE_00B756
	STA.w DMA[$00].SizeLo
	SEP.b #$10
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$3800
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDX.b #$705800>>16
	STX.w DMA[$00].SourceBank
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	SEP.b #$20
	RTS

DATA_01E8C7:
	dw $8000,$0000,$0208

DATA_01E8CD:
	dw $0001,$FF08

CODE_01E8D1:
	LDA.b #!REGISTER_BG2HorizScrollOffset
	STA.w HDMA[$04].Destination
	LDA.b #!REGISTER_BG2VertScrollOffset
	STA.w HDMA[$03].Destination
	STZ.w $0D2B
	STZ.w $0D2D
	REP.b #$20
	LDA.w #DATA_01E8C7
	STA.w $0D2F
	LDA.w #DATA_01E8CD
	STA.w $0D31
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01E8F2:
	dw $3400,$47FF,$01CE
	dw $FFFF

DATA_01E8FA:
	dw $3400,$47FF,$0111
	dw $FFFF

DATA_01E902:
	dw $3400,$47FF,$01CE
	dw $FFFF

DATA_01E90A:
DATA_bg3_tilemap_table:
	db $DC,$00,$01,$DD,$00,$FF,$E5,$00,$00,$E5,$00,$00,$DE,$00,$FF,$DF
	db $00,$FF,$E0,$00,$FF,$E4,$00,$FF,$00,$00,$00,$00,$00,$00,$E1,$00
	db $FF,$E6,$00,$00,$E7,$00,$00,$E8,$00,$1B,$E9,$00,$26,$EA,$00,$00
	db $EB,$00,$FF,$EC,$00,$00,$ED,$00,$80,$EE,$00,$31,$EF,$00,$00,$F0
	db $00,$00,$F1,$00,$00,$F2,$00,$00,$F3,$00,$00,$F4,$00,$00,$F5,$00
	db $00,$F6,$00,$00,$ED,$00,$3C,$F7,$00,$81,$F8,$00,$00,$F9,$00,$82
	db $FB,$00,$00,$FC,$00,$83,$FD,$00,$84,$FE,$00,$85,$FF,$00,$00,$00
	db $01,$00,$01,$01,$00,$02,$01,$00,$03,$01,$00,$04,$01,$86,$05,$01
	db $00,$06,$01,$87,$06,$01,$00,$07,$01,$00,$08,$01,$00,$00,$00,$00
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
	db $00,$00,$00,$00

DATA_01E9AE:
	db $00,$02,$10,$00,$04,$10,$00,$04,$10,$00,$04,$10,$00,$04,$10,$00
	db $04,$10,$00,$04,$10,$00,$04,$12,$10,$00,$00,$06,$8A,$00,$04,$0A
	db $00,$04,$16,$0A,$06,$00,$06,$8A,$00,$04,$09,$00,$04,$17,$09,$06
	db $00,$06,$90,$00,$04,$06,$0D,$04,$0C,$13,$06,$00,$06,$F5,$00,$04
	db $81,$01,$04,$89,$02,$04,$00

;-------------------------------------------------------------------------
; CODE_load_bg3_tilemap. Called from gm0c.
; Decompresses the level's BG3 tilemap into VRAM $3400. Indexed by
; !RAM_YI_Level_LevelHeaderBG3TilesetLo (1..N). Tileset ID 0 = no BG3.
; Per DATA_bg3_tilemap_table (one 3-byte row per tileset), reads a "special-action
; byte" that triggers various BG3 modes via DATA_bg3_special_routine dispatch
; (8 entries: low_water_adjust, transparency, wavy_mist, sun, clouds_mist,
; screen_des, horiz_scroll).
; Big DMA: $0800 bytes from $70:5800 into VRAM $3400.
;-------------------------------------------------------------------------
CODE_01E9F5:
CODE_load_bg3_tilemap:
	LDY.b #$09
	LDA.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	BEQ.b CODE_01EA39
	ASL
	ADC.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	TAY
	REP.b #$20
	LDA.w DATA_bg3_tilemap_table-$03,y
	BEQ.b CODE_01EA40
	REP.b #$10
	LDX.w #$5800
	PHY
	JSL.l CODE_00B756
	PLY
	LDX.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	CPX.w #$0016
	BNE.b CODE_01EA43
	LDX.w #$7E5DA6
	STX.b $20
	LDX.w #$7E5DA6>>16
	STX.b $22
	LDX.w #$705800
	STX.b $23
	LDX.w #$705800>>16
	STX.b $25
	SEP.b #$10
	JSL.l CODE_dma_wram_gen_purpose
	SEP.b #$20
	LDY.b #$1B
CODE_01EA39:
	STY.w $0127
	JSL.l CODE_prepare_tilemap_dma_queue_l
CODE_01EA40:
	SEP.b #$20
	RTS

CODE_01EA43:
	SEP.b #$10
	STA.w DMA[$00].SizeLo
	STA.b $00
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #$3400
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDX.b #$705800>>16
	STX.w DMA[$00].SourceBank
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$000A
	BNE.b CODE_01EA87
	LDA.b $00
	STA.w DMA[$00].SizeLo
	LDA.w #$0000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$5800
	STA.w DMA[$00].SourceLo
	STX.w !REGISTER_DMAEnable
CODE_01EA87:
	SEP.b #$20
	LDX.w DATA_bg3_tilemap_table-$01,y
	BEQ.b CODE_01EA40
	CPX.b #$FF
	BEQ.b CODE_01EAA0
	TXA
	BPL.b CODE_01EAA9
	ASL
	CMP.b #$10
	BCS.b CODE_01EAA0
	TAX
	JSR.w (DATA_bg3_special_routine,x)
	BRA.b CODE_01EA40

CODE_01EAA0:
	LDA.b #$04
	TRB.w !RAM_YI_Global_MainScreenLayers
	TRB.w !RAM_YI_Global_SubScreenLayers
	RTS

CODE_01EAA9:
	LDA.l DATA_01E9AE,x
	STA.w $0D3B
	PHB
	LDA.b #$703D4A>>16
	PHA
	PLB
	REP.b #$10
	LDY.w #$0000
	STZ.b $08
CODE_01EABC:
	LDA.l DATA_01E9AE+$01,x
	BEQ.b CODE_01EB25
	STA.b $01
	REP.b #$20
	AND.w #$007F
	ASL
	ASL
	ASL
	ASL
	STA.b $02
	LDA.l DATA_01E9AE+$02,x
	AND.w #$00FF
	ASL
	ASL
	ASL
	ASL
	STA.b $04
	LDA.l DATA_01E9AE+$03,x
	AND.w #$00FF
	STA.b $06
CODE_01EAE5:
	LDA.b $04
	SEC
	SBC.b $08
	STA.w $703D4C,y
	LDA.w #$0010
	BIT.b $00
	BMI.b CODE_01EAFE
	LDA.b $04
	CLC
	ADC.w #$0010
	STA.b $04
	LDA.b $02
CODE_01EAFE:
	STA.w $703D4A,y
	LDA.b $08
	CLC
	ADC.w #$0010
	STA.b $08
	LDA.b $06
	STA.w $703D4E,y
	TYA
	CLC
	ADC.w #$0006
	TAY
	LDA.b $02
	SEC
	SBC.w #$0010
	STA.b $02
	BNE.b CODE_01EAE5
	SEP.b #$20
	INX
	INX
	INX
	BRA.b CODE_01EABC

CODE_01EB25:
	PLB
	SEP.b #$10
	RTS

;---------------------------------------------------------------------------

DATA_01EB29:
DATA_bg3_special_routine:
	dw CODE_bg3_low_water_adjust
	dw CODE_setup_bg3_horiz_scroll_hdma
	dw CODE_setup_bg3_screen_des_hdma
	dw CODE_setup_bg3_clouds_mist_hdma
	dw CODE_setup_bg3_sun_hdma
	dw CODE_setup_bg3_transparency
	dw CODE_setup_bg3_horiz_scroll_hdma
	dw CODE_setup_bg3_wavy_mist_hdma

DATA_01EB39:
DATA_bg3_low_water_vram_ptr:
	dw $3740

DATA_01EB3B:
DATA_bg3_low_water_vram_size:
	dw $0680

;-------------------------------------------------------------------------
; CODE_bg3_low_water_adjust. Special BG3 init for water-surface
; levels: reduces the BG3 tilemap from $3740 / $0680 down so that the
; bottom half (below the water-line) is freed for the wavy-water HDMA
; effect.
;-------------------------------------------------------------------------
CODE_01EB3D:
CODE_bg3_low_water_adjust:
	PHX
	LDY.b #$21
	STY.w $0127
	JSL.l CODE_prepare_tilemap_dma_queue_l
	PLA
	REP.b #$20
	AND.w #$00FF
	ASL
	TAX
	LDA.w DATA_bg3_low_water_vram_ptr,x
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0800
	SEC
	SBC.w DATA_bg3_low_water_vram_size,x
	STA.w DMA[$00].SizeLo
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDX.b #$705800>>16
	STX.w DMA[$00].SourceBank
	LDA.w #$705800
	STA.w DMA[$00].SourceLo
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_01EB7D:
	db $00,$20,$00,$07,$00,$00,$30,$00,$27,$00,$00,$20,$00,$37,$00,$00
	db $2E,$00,$57,$00,$00,$20,$00,$67,$00,$00,$2C,$00,$87,$00,$00,$20
	db $00,$97,$00,$00,$2A,$00,$B7,$00,$00,$10,$00,$37,$01,$00,$28,$00
	db $57,$01,$00,$20,$00,$67,$01,$00,$40,$00,$00,$08

DATA_01EBB9:
	db $00,$1A,$00,$17,$06,$00,$2E,$00,$57,$06,$00,$19,$00,$77,$06,$00
	db $2C,$00,$C7,$06,$00,$18,$00,$D7,$06,$00,$2A,$00,$07,$07,$00,$17
	db $00,$17,$07,$00,$28,$00,$57,$07,$00,$16,$00,$67,$07,$00,$C0,$00
	db $B7,$07,$00,$40,$01,$00,$08

DATA_01EBF0:
	db $00,$16,$00,$77,$07,$82,$00,$90,$00,$00,$08,$A0

DATA_01EBFC:
	db $00,$2A,$00,$27,$00,$00,$1A,$00,$57,$00,$00,$28,$00,$87,$00,$00
	db $18,$00,$B7,$00,$00,$26,$00,$E7,$00,$00,$16,$00,$07,$01,$00,$12
	db $00,$27,$01,$82,$00,$10,$00,$67,$01,$10,$80,$00,$20,$00,$87,$01
	db $00,$30,$00,$00,$08

DATA_01EC31:
	db $00,$00,$00,$17,$00,$00,$20,$00,$37,$00,$00,$00,$00,$47,$00,$00
	db $00,$00,$67,$00,$00,$1C,$00,$97,$00,$00,$1A,$00,$C7,$00,$00,$00
	db $00,$C7,$00,$00,$18,$00,$E7,$00,$00,$00,$00,$67,$01,$00,$40,$00
	db $00,$08

DATA_01EC63:
	db $82,$00,$00,$01,$00,$08,$08

DATA_01EC6A:
	dw DATA_01EB7D,DATA_01EBB9,DATA_01EBF0,DATA_01EBFC,$0000,DATA_01EC31,DATA_01EC63

;-------------------------------------------------------------------------
; CODE_setup_bg3_wavy_mist_hdma. Arms BG3 horiz-scroll HDMA
; (channel 4) for the wavy-mist effect. $0D43 = 4 (wavy mist mode).
;-------------------------------------------------------------------------
CODE_01EC78:
CODE_setup_bg3_wavy_mist_hdma:
	LDA.b #$04
	STA.w $0D43
	BRA.b CODE_setup_bg3_horiz_scroll_hdma

;-------------------------------------------------------------------------
; CODE_setup_bg3_screen_des_hdma. Arms a screen-designation
; HDMA via CODE_setup_special_hdma(X=0): writes to !REGISTER_MainScreenLayers
; via DATA_01EC96 (8-byte block). Used for per-scanline layer
; enable/disable effects (mist, mosaic windows).
;-------------------------------------------------------------------------
CODE_01EC7F:
CODE_setup_bg3_screen_des_hdma:
	PHX
	LDX.b #$00
	JSR.w CODE_setup_special_hdma
	PLX
;-------------------------------------------------------------------------
; CODE_setup_bg3_horiz_scroll_hdma. Common BG3 horiz-scroll
; HDMA arming. Sets $0D3D = 1, $0D3F = DATA_01EC6A[X] (data ptr table
; selection).
;-------------------------------------------------------------------------
CODE_01EC86:
CODE_setup_bg3_horiz_scroll_hdma:
	LDA.b #$01
	STA.w $0D3D
	REP.b #$20
	LDA.w DATA_01EC6A-$02,x
	STA.w $0D3F
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

DATA_01EC96:
	db $11,$06,$B7,$07,$15,$02,$00,$08

DATA_01EC9E:
	db $22,$20,$87,$07,$22,$62,$00,$08

DATA_01ECA6:
DATA_special_hdma_enable_flag:
	db $08,$08

DATA_01ECA8:
DATA_special_hdma_data_ptr:
	dw DATA_01EC96,DATA_01EC9E

DATA_01ECAC:
DATA_special_hdma_regs:
	db !REGISTER_MainScreenLayers,!REGISTER_ColorMathInitialSettings

;-------------------------------------------------------------------------
; CODE_setup_special_hdma. Generic helper to arm an HDMA
; channel pre-set from DATA_special_hdma_enable_flag (enable mask -> $0D27), DATA_special_hdma_data_ptr
; (data ptr -> $0D28), DATA_special_hdma_regs (target register byte). Sets HDMA
; channel 4 parameters byte to $41 (indirect, 2-byte transfer per row).
;-------------------------------------------------------------------------
CODE_01ECAE:
CODE_setup_special_hdma:
	LDA.w DATA_special_hdma_enable_flag,x
	INC
	STA.w $0D27
	REP.b #$20
	TXA
	AND.w #$00FF
	TAY
	ASL
	TAX
	LDA.w DATA_special_hdma_data_ptr,x
	STA.w $0D28
	SEP.b #$20
	LDA.b #$41
	STA.w HDMA[$04].Parameters
	LDA.w DATA_special_hdma_regs,y
	STA.w HDMA[$04].Destination
	RTS

;---------------------------------------------------------------------------

DATA_01ECD2:
	db $00,$29,$07,$01,$65,$07,$00,$00,$08,$FF

DATA_01ECDC:
	db $0C,$00,$0C,$00,$E0,$00,$19,$00,$1F,$12,$40,$00,$1F,$12,$19,$00
	db $40,$00,$0C,$00,$0C,$00,$50,$00,$FF,$FF

DATA_01ECF6:
	db $2C,$5E,$2C,$5E,$E0,$00,$EE,$6E,$F8,$6E,$40,$00,$F8,$6E,$EE,$6E
	db $40,$00,$2C,$5E,$2C,$5E,$50,$00,$FF,$FF

DATA_01ED10:
	dw DATA_01ECDC,DATA_01ECF6

;-------------------------------------------------------------------------
; CODE_setup_bg3_sun_hdma. Arms the "rising sun" BG3 HDMA
; effect. JSR CODE_setup_bg3_horiz_scroll_hdma first, then runs SuperFX
; FXCODE_08EBB5 to generate the sun-gradient data at $70:5800 (using
; DATA_01ECDC or DATA_01ECF6 per BG3 palette parity), DMAs to $7F:56DE.
; Sets $0D47 = DATA_01ECD2 (sun-radius table), enables HDMA bit $06
; (channels 1+2 for sun mask), enables BG3 vert-scroll HDMA, INC $0D45
; (sun-active flag), INC $0D0D (level frame counter).
;-------------------------------------------------------------------------
CODE_01ED14:
CODE_setup_bg3_sun_hdma:
	JSR.w CODE_setup_bg3_horiz_scroll_hdma
	LDY.b #$00
	LDA.w !RAM_YI_Level_LevelHeaderBG3PaletteLo
	AND.b #$01
	BEQ.b CODE_01ED22
	LDY.b #$02
CODE_01ED22:
	REP.b #$20
	LDA.w #DATA_01ECDC>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w DATA_01ED10,y
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDX.b #FXCODE_08EBB5>>16
	LDA.w #FXCODE_08EBB5
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w #$7F56DE
	STA.b $20
	LDY.b #$7F56DE>>16
	STY.b $22
	LDA.w #$705800
	STA.b $23
	LDY.b #$705800>>16
	STY.b $25
	LDA.w #$0522
	JSL.l CODE_dma_wram_gen_purpose
	LDA.w #DATA_01ECD2
	STA.w $0D47
	STZ.w $0D4B
	STZ.w $0D2B
	STZ.w $0D2D
	SEP.b #$20
	LDA.b #!REGISTER_BG3VertScrollOffset
	STA.w HDMA[$04].Destination
	INC.w $0D0D
	LDA.w !RAM_YI_Global_HDMAEnable
	ORA.b #$06
	STA.w !RAM_YI_Global_HDMAEnable
	INC.w $0D45
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_setup_bg3_clouds_mist_hdma. MainScreen = $17 (BG1+2+3),
; SubScreen = $04 (BG3 only), arms screen-des HDMA + horiz-scroll HDMA
; for the multilevel-clouds effect.
;-------------------------------------------------------------------------
CODE_01ED77:
CODE_setup_bg3_clouds_mist_hdma:
	LDA.b #$17
	STA.w !RAM_YI_Global_MainScreenLayers
	LDA.b #$04
	STA.w !RAM_YI_Global_SubScreenLayers
	LDX.b #$01
	JSR.w CODE_setup_special_hdma
	LDX.b #$06
	JSR.w CODE_setup_bg3_horiz_scroll_hdma
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_setup_bg3_transparency. Color-math regs: $2130 = $A0
; (subtract math, half result), $2131 = $64 (BG3 + obj on math, fixed
; color = 0). Used for "see-through BG3" effects (water, mist).
;-------------------------------------------------------------------------
CODE_01ED8C:
CODE_setup_bg3_transparency:
	LDA.b #$A0
	STA.w !RAM_YI_Global_ColorMathInitialSettings
	LDA.b #$64
	STA.w !RAM_YI_Global_ColorMathSelectAndEnable
	RTS

;---------------------------------------------------------------------------

UNK_01ED97:
	dw UNK_01ED9B,UNK_01EDA5

UNK_01ED9B:
	db $FF,$20,$BD,$B2,$B6,$AE,$D0,$BE,$B9,$FD

UNK_01EDA5:
	db $FF,$20,$C2,$B8,$BE,$D0,$B5,$B8,$BC,$BD,$FD

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($01EDBD, incbin, DATA_01EDBD_YI_U2.bin)
else
	%FREE_BYTES($01EDB0, 4688, $FF)
endif
%BANK_END(<EndBank>)
endmacro
