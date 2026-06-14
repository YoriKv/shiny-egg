;#############################################################################################################
;# Bank00.asm -- bank $00 main game code: reset vector, game loop, NMI/IRQ, SPC700 upload, ambient sprites,
;#               scene gfx/palette loaders, RAM-resident interrupt trampolines, tilemap/VRAM DMA queues.
;#
;# Contents at a glance:
;#   $00:8000-$00:80EF  Reset entry CODE_yi_reset: init SNES regs, copy ROM-header vector trampolines into WRAM,
;#                      SPC engine upload, SuperFX bring-up, SRAM checksum verify+regen.
;#   $00:80F0-$00:813E  CODE_GameLoop: wait-for-VBlank loop, debug frame-stepper (DEBUG builds only),
;#                      call CODE_run_current_gamemode.
;#   $00:813F-$00:814F  YI_ROMHeaderVectorRAMCodeBlock: 16-byte block copied to $7E:0100-$7E:010F
;#                      so NMI/IRQ vectors (hardware-mirrored at $00:FFEA/$00:FFEE) jump through RAM.
;#                      The two JML.l !RAM_YI_Global_VBlankRt / !RAM_YI_Global_IRQRt sit here.
;#   $00:8150-$00:8238  CODE_run_current_gamemode dispatcher + 69-entry DATA_game_mode_pointers ($00 .. $44).
;#   $00:8239-$00:8287  CODE_disable_nmi / CODE_enable_nmi / CODE_init_oam / CODE_init_oam_buffer / CODE_oam_high_buffer_to_table
;#                      (the first three SuperFX init stubs).
;#   $00:8288-$00:8364  CODE_dma_wram_gen_purpose + CODE_dma_init_gen_purpose + RAM/SRAM clears used by reset
;#                      and CODE_clear_basic_states.
;#   $00:8365-$00:83A7  CODE_execute_ptr / ADDR_execute_ptr_long: pull-callsite jump-table dispatchers.
;#   $00:83A8-$00:8407  Fade-in/out screen game modes (gm1e, CODE_gm_fade_screen_in_out, CODE_gm_fade_alt, etc).
;#   $00:8408-$00:841E  CODE_random_number_gen: latches H/V counters and accumulates into !s_rng.
;#   $00:841F-$00:85D1  CODE_SPC700Upload + DATA_SPC_ptr / DATA_spc_data_blocks / DATA_item_denial_table /
;#                      DATA_spc_block_set_indexes / CODE_set_level_music / CODE_upload_music_data.
;#   $00:85D2-$00:85DB  CODE_push_sound_queue: append sound ID to !RAM_YI_Global_SoundQueue.
;#   $00:85DC-$00:89CB  V1.0-only sprite macros (Kamek "OH MY!", Background Shy-Guy, Thin Platform).
;#                      Hoisted into per-sprite ROUTINE_YI_* macros under U2.
;#   $00:89CC-$00:AD6C  Ambient-sprite system: 120-entry dispatch table at $00:89CC,
;#                      CODE_handle_ambient_sprites driver, ~70 ambient_* main routines (splashes, puffs,
;#                      sparkles, minigame effects, etc).
;#   $00:AF39-$00:B338  Scene gfx layout tables: DATA_bg1_tileset_files / DATA_bg1_dark_tileset_files /
;#                      DATA_bg2_tileset_files / DATA_bg3_tilesets_files / DATA_spriteset_files.
;#   $00:B339-$00:B789  CODE_load_level_gfx + LZ2 decompressor dispatch + world-map gfx tables + DATA_scene_palette_layout.
;#   $00:B78A-$00:BBAE  Palette layout/ptr tables and CODE_load_level_palettes + CODE_load_palettes.
;#   $00:BBAF-$00:BFF5  Scene register layout tables + CODE_init_scene_regs + CODE_copy_division_lookup_to_sram.
;#   $00:C000-$00:C40B  NMI + CODE_play_music_track + CODE_handle_sound + interrupt-mode dispatch table.
;#   $00:C40A-$00:CCFF  IRQ_Handler / IRQ_Start / IRQ_Return + per-mode IRQ handlers
;#                      (normal-level, offset-per-tile, Raphael boss, story cutscene, credits).
;#   $00:D308-$00:D56F  CODE_irq_bonus_game + queue helpers (CODE_00D4AC etc).
;#   $00:D571-$00:DB99  CODE_init_tileset_animation + BG tile-animation pointer tables and animators
;#                      (CODE_tile_animation_00 .. CODE_tile_animation_11, water/clouds/lava/butterfly/etc).
;#   $00:DB9A-$00:DE43  Tilemap stitch helpers (CODE_bg3_tilemap_stitch / CODE_bg3_tilemap_flush used by NMI).
;#   $00:DE44-$00:E36F  SuperFX init/maintenance routines (gsu_init_1 .. CODE_gsu_init_5).
;#   $00:E372-$00:E4E0  CODE_push_sound_queue_pres_x + tilemap DMA queue (prepare/process variants).
;#   $00:E4E1-$00:E54F  CODE_process_vram_dma_queue + update_controllers + scratch.
;#   $00:E552-$00:EBD3  DATA_div_onebyx_lut (768-byte 1/x lookup) + Raphael Mode-7 matrix tables.
;#   $00:EBD4-$00:F7A6  Per-level data blobs (incbin LevelData/DATA_00*.bin).
;#   $00:F7A7-$00:FFFF  Free space / ROM header (UNK_00FFA0 has 5-byte V1.0/V1.1 build stamp).
;#
;# Cross-references:
;#   Raidenthequick disassembly/bank00.asm  -- best descriptive labels (CODE_yi_reset, CODE_GameLoop, NMI, IRQ_*,
;#                                              CODE_load_level_gfx, CODE_load_palettes, ambient_*, tile_animation_*,
;#                                              gsu_init_*, etc) and per-line cart-address annotations.
;#   docs/named_main_labels.txt             -- index of all descriptive labels by bank.
;#   ys_init.asm / ys_main.asm              -- reset path and game loop (naming/concepts reference).
;#   Wiki: yoshisisland-disassembly/wiki     -- game mode reference, IRQ system, SPC upload protocol.
;#
;# Notes:
;#   - All M/X conventions follow standard YI calling convention unless noted: routines invoked
;#     by the dispatcher (game modes, IRQ handlers) preserve DBR/D and re-enter with explicit SEP/REP.
;#   - Bank $00 holds the firmware-critical reset, NMI, and IRQ paths -- changing a single byte here
;#     can brick the boot. Comment-only edits are safe (asar emits no bytes for ; lines).
;#############################################################################################################

macro YIBank00Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

;-------------------------------------------------------------------------
; CODE_yi_reset -- SNES cold-boot entry, jumped to from the ROM header reset vector ($00:FFFC).
; See also: ys_init.asm.
; Raidenthequick: CODE_yi_reset.
;
; INPUTS:   none (cold-boot; SNES is in emulation mode at first cycle)
; OUTPUTS:  CPU in native mode; SRAM verified or regenerated; SPC engine
;           uploaded; WRAM zeroed; main-RAM code block resident at $7E:C000;
;           SuperFX initialised; interrupts enabled. Falls through to CODE_GameLoop.
; MODIFIES: All of $7E:0000-$7E:BFFF, $7F:0000-$7F:FFFF, $70:0000-$70:7BFF
;           (zeroed); $7E:0100-$7E:010F (interrupt trampoline block);
;           $7E:C000+ (main RAM code block); APU ports $2140-$2143;
;           PPU regs $2100, $213E-$213F, $4200, $420B-$420C, $4202-$4203;
;           SuperFX regs $3000-$303F.
; CALLERS:  ROM-header reset vector $00:FFFC only.
;
; Sequence (all under SEI):
;   1. XCE to native mode, set DBR=$00, D=$0000, stack at $01FF.
;   2. Mask off NMI/IRQ/auto-joypad, force PPU forced-blank, clear APU ports, latch counters.
;   3. Enable backup-RAM writes, clear DMA/HDMA enables.
;   4. Set up OAM, stack.
;   5. JSL CODE_0082D0 (zero out WRAM and most of SRAM).
;   6. JSL CODE_set_level_music with X=$10 to upload the SPC engine.
;   7. DMA the 16-byte ROM-header vector block ($00:813F-$00:814E) into $7E:0101-$7E:010F so
;      the JML trampolines for NMI/IRQ are reachable from any bank.
;   8. DMA the 16 KB main RAM code block (CODE/data living between !RAM_YI_Global_MainRAMCodeBlock and
;      ROMBANK00_END) into WRAM at $7E:C000+.
;   9. Init SuperFX (clock select 20 MHz; high-speed only on V1.1; SCBR=$16, screen mode flags).
;  10. JSL FXCODE_08A97B via BeginSuperFXProcessing to initialise SuperFX RAMBR.
;  11. SRAM-checksum verify ($707E7C-$707E7D guard bytes). If corrupt -> rewrite save header and
;      JSL CODE_verify_save_checksums (Bank 10 save-file regeneration).
;  12. CLI and fall through into CODE_GameLoop.
;-------------------------------------------------------------------------
CODE_008000:
CODE_yi_reset:
	SEI
	REP.b #$09
	XCE
	SEP.b #$30
	LDA.b #CODE_yi_reset>>16
	PHA
	PLB
if !CurrentBank != $00
	LDA.b #$00
endif
	PHA
	PHA
	PLD
	STZ.w !REGISTER_IRQNMIAndJoypadEnableFlags
	STZ.w !REGISTER_JoypadSerialPort1
	LDA.b #$8F
	STA.w !REGISTER_ScreenDisplayRegister
	LDA.b #!SuperFX_BackupRAMRegister_EnableBRAMWrite
	STA.w !REGISTER_SuperFX_BackupRAMRegister
	STZ.w !REGISTER_MosaicSizeAndBGEnable
	STZ.w !REGISTER_APUPort0
	STZ.w !REGISTER_APUPort1
	STZ.w !REGISTER_APUPort2
	STZ.w !REGISTER_APUPort3
	LDA.b #$FF
	STA.w !REGISTER_ProgrammableIOPortOutput
	STZ.w !REGISTER_HCountTimerLo
	STZ.w !REGISTER_HCountTimerHi
	STZ.w !REGISTER_VCountTimerLo
	STZ.w !REGISTER_VCountTimerHi
	STZ.w !REGISTER_DMAEnable
	STZ.w !REGISTER_HDMAEnable
	STZ.w !REGISTER_EnableFastROM
	REP.b #$20
	LDA.w #$8000
	STA.w !REGISTER_OAMAddressLo
	LDA.w #$01FF
	TCS
	SEP.b #$20
	JSL.l CODE_0082D0
	LDX.b #$10
	JSL.l CODE_set_level_music
	REP.b #$20
	LDX.b #$0F
CODE_008062:
	LDA.w YI_ROMHeaderVectorRAMCodeBlock,x
	STA.w $0100,x
	DEX
	DEX
	BPL.b CODE_008062
	LDA.w #!RAM_YI_Global_MainRAMCodeBlock
	STA.b $20
	LDY.b #!RAM_YI_Global_MainRAMCodeBlock>>16
	STY.b $22
	LDA.w #YI_MainRAMCodeBlock
	STA.b $23
	LDY.b #YI_MainRAMCodeBlock>>16
	STY.b $25
	LDA.w #ROMBANK00_END-YI_MainRAMCodeBlock
	JSL.l CODE_dma_wram_gen_purpose
	SEP.b #$20
	REP.b #$10
	LDX.w #$0046
CODE_00808C:
	STZ.w !RAM_YI_Global_CurrentGameMode,x
	DEX
	BPL.b CODE_00808C
	SEP.b #$10
	LDA.b #!SuperFX_ClockSelect_20MHz
	STA.w !REGISTER_SuperFX_ClockSelect
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	LDA.b #!SuperFX_ConfigRegister_MaskedIRQ
else
	LDA.b #!SuperFX_ConfigRegister_HighSpeedFlag|!SuperFX_ConfigRegister_MaskedIRQ
endif
	STA.w !REGISTER_SuperFX_ConfigRegister
	LDA.b #$16
	STA.w $012D
	LDA.b #!SuperFX_ScreenMode_ScreenHeight_160pixels|!SuperFX_ScreenMode_ColorMode_16Colors|!SuperFX_ScreenMode_SuperFXHasWRAMAccess|!SuperFX_ScreenMode_SuperFXHasROMAccess|!SuperFX_ScreenMode_ColorMode_Unused
	STA.w $012E
	REP.b #$20
	STZ.w $012B
	STZ.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	LDX.b #FXCODE_08A97B>>16
	LDA.w #FXCODE_08A97B
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	LDA.l $707E7D
	BNE.b CODE_0080C9
	LDA.l $707E7C
	CMP.b #$03
	BCC.b CODE_0080F0
CODE_0080C9:
	REP.b #$20
	LDA.w #$0000
	STA.l $707E7C
	STA.l $707E70
	STA.l $707E72
	STA.l $707E74
	STA.l $707E76
	STA.l $707E78
	STA.l $707E7A
	JSL.l CODE_verify_save_checksums
	SEP.b #$20
CODE_0080F0:
	CLI                                       ; enable interrupts -- end of cold-boot setup
;-------------------------------------------------------------------------
; CODE_GameLoop -- main loop, run forever.
; See also: ys_main.asm (upstream main-loop structure).
; $011B is the "frame complete" sentinel: NMI/IRQ decrements it; this loop
; spins (BMI) until it goes non-negative, then runs one game-mode tick and
; decrements again before going back to wait. The DEBUG branch (only when
; !Define_YI_Global_EnableDebugFeatures == !TRUE) enables a frame stepper
; via controller 2 (start advances one frame, R-button toggles step mode).
; Production builds skip straight to CODE_008130 via BRA.
;
; INPUTS:   $011B = frame-pacing sentinel (decremented by NMI when a video
;           frame completes); debug builds also consume $0940/$0942/$0943
;           (joy2 raw + edge) and $012F/$0130 (step-mode flag + cooldown).
; OUTPUTS:  none -- loop never returns.
; MODIFIES: $30 (!r_frame_counter_global_dp, +1/frame); $011B (decremented
;           after each game-mode tick); whatever the dispatched game mode
;           touches (essentially everything).
; CALLERS:  CODE_yi_reset (falls through). Never JSR/JSL'd.
;-------------------------------------------------------------------------
CODE_0080F1:
CODE_GameLoop:                                     ; Raidenthequick: CODE_GameLoop
	LDA.w $011B                               ; \ frame-complete sentinel (set by NMI / IRQ)
	BMI.b CODE_0080F1                         ; / spin until interrupt clears the high bit
if !Define_YI_Global_EnableDebugFeatures == !TRUE
	NOP #2                                    ;   debug build: fall through into frame-stepper
else
	BRA.b CODE_008130                         ;   release build: jump past debug code -- SMWC tweak: $0080F7 byte is BRA-offset [$38]; change [38]->[00] (i.e. NOP) to enable the debug stepper that starts at $0080F8.
endif

ADDR_0080F8:                                  ; DEBUG-only frame-stepper entry (controller 2)
	LDA.w $0943                               ; joy2 hi-pressed
	AND.b #$10                                ; \ start button (bit $10)
	BEQ.b ADDR_008107                         ; / not pressed -> skip toggle
	LDA.w $012F
	EOR.b #$01
	STA.w $012F
ADDR_008107:
	LDA.w $012F
	BEQ.b CODE_008130
	LDY.b #$20                                ; SMWC tweak $00810D: number of frames to skip before frame-advance after R initially pressed (default [$20]).
	LDA.w $0942
	AND.b #$10
	BNE.b ADDR_00812D
	LDA.w $0940
	AND.b #$30
	BNE.b ADDR_008121
	STZ.w $0130
	BRA.b CODE_00813A

ADDR_008121:
	LDA.w $0130
	BEQ.b ADDR_00812B
	DEC.w $0130
	BRA.b CODE_00813A

ADDR_00812B:
	LDY.b #$04                                ; SMWC tweak $00812C: frames between game-mode ticks while frame-advance is held (default [$04]).
ADDR_00812D:
	STY.w $0130
CODE_008130:                                  ; (one-frame tick: shared by debug and release paths)
	REP.b #$20
	INC.b $30                                 ; bump !r_frame_counter_global_dp (direct-page frame counter)
	SEP.b #$20
	JSL.l CODE_run_current_gamemode                         ; CODE_run_current_gamemode -- dispatch to current game mode
CODE_00813A:
	DEC.w $011B                               ; \ end this frame; -1 means "waiting for next interrupt"
	BRA.b CODE_0080F1                         ; / back to CODE_GameLoop spin

;-------------------------------------------------------------------------
; YI_ROMHeaderVectorRAMCodeBlock -- 16-byte stub copied into $7E:0101-$7E:010F at boot.
; Raidenthequick: CODE_00813F (the data block immediately after CODE_GameLoop).
; The ROM header at $00:FFE0-$00:FFFF aliases the native-mode NMI/IRQ vectors
; to $7E:01xx in WRAM so the firmware can hot-swap them: this block provides
; the JMLs that bounce the interrupt back into the live game-mode dispatcher.
;-------------------------------------------------------------------------
YI_ROMHeaderVectorRAMCodeBlock:
;$00813F
	RTI                                       ; vector slot: COP / fallback
	NOP #3

CODE_008143:
	RTI                                       ; vector slot: BRK
	NOP #3

CODE_008147:
	JML.l !RAM_YI_Global_VBlankRt             ; native NMI vector lands here -> RAM NMI handler

CODE_00814B:
	JML.l !RAM_YI_Global_IRQRt                ; native IRQ vector lands here -> RAM IRQ handler

CODE_00814F:
CODE_unused_interrupt:                             ; Raidenthequick: CODE_unused_interrupt
	RTI

;EndOfROMHeaderVectorRAMCodeBlock

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_run_current_gamemode -- jump-table dispatcher for the 69 game modes ($00..$44).
; Raidenthequick: CODE_run_current_gamemode.
; See also: ys_game.asm (the upstream gamemode dispatcher).
; Each entry in DATA_game_mode_pointers is a 24-bit pointer minus 1 (so RTL lands on the right byte).
; The dispatcher loads M=8, X=8; the called handler is responsible for re-entering
; whatever width it needs and ultimately RTLing back into the CODE_GameLoop.
;
; Index into DATA_game_mode_pointers is gamemode*3 (ASL+ADC). PHB+PLB sets the bank to the
; handler's, then PHA-low/PHA-high build an RTL return target.
;
; INPUTS:   M=8/X=8 (caller is CODE_GameLoop); !RAM_YI_Global_CurrentGameMode
;           = current mode index in [0..68]. DBR=$00.
; OUTPUTS:  none directly. After the handler RTLs, control returns to the
;           caller (CODE_GameLoop). Handler may overwrite CurrentGameMode to chain.
; MODIFIES: A/X (clobbered); pushes 3 bytes to stack then RTL consumes them.
;           DBR is restored to caller's via initial PHB; handler must not
;           leave DBR changed across its RTL (most rebuild it themselves).
; CALLERS:  CODE_GameLoop only (JSL via CODE_008130).
;-------------------------------------------------------------------------
CODE_008150:
CODE_run_current_gamemode:                         ; Raidenthequick: CODE_run_current_gamemode
	LDA.w !RAM_YI_Global_CurrentGameMode
	ASL                                       ; \ x3 for 24-bit table stride
	ADC.w !RAM_YI_Global_CurrentGameMode      ; /
	TAX
	PHB
	LDA.w DATA_game_mode_pointers+$02,x                   ; bank byte
	PHA
	PHA
	PLB                                       ;   set DBR to handler's bank
	LDA.l DATA_game_mode_pointers+$01,x                   ; hi-byte of address-1
	PHA
	LDA.l DATA_game_mode_pointers,x                       ; lo-byte of address-1
	PHA
	RTL                                       ; jump to handler (RTL pops the address+1)

;-------------------------------------------------------------------------
; DATA_game_mode_pointers -- 69-entry DATA_game_mode_pointers table (3 bytes each, address-1).
; Mode IDs mirror Raidenthequick's per-line annotations; some recurring helpers:
;   CODE_gm_fade_screen_in_out  CODE_gm_fade_screen_in_out (modes $04 $06 $0B $12 $14 $1A $21 $23 $25 $27 $2B $2D $2F $32 $34 $3A $3C $41 $43)
;   CODE_gm_fade_alt  CODE_gm_fade_alt           (modes $02 $08 $1F $29 $37)
;   CODE_gm1e_start_select_level_fade  CODE_gm1e_start_select_level_fade
;   CODE_gm16_world_end_cutscene_load  CODE_gm16_world_end_cutscene_load
; The handler addresses jump into other banks (Bank10 boot screens, Bank01/17 in-level
; logic, Bank17 cutscenes, etc) -- see Raidenthequick bank00.asm:198+ for full per-row annotations.
;-------------------------------------------------------------------------
DATA_00816A:
DATA_game_mode_pointers:                           ; Raidenthequick: DATA_game_mode_pointers
	dl CODE_gm00_ninpresents_prep-$01
	dl CODE_gm01_ninpresents_load-$01
	dl CODE_gm_fade_alt-$01
	dl CODE_gm03_ninpresents_show-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm05_load_cutscene-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm07_cutscene-$01
	dl CODE_gm_fade_alt-$01
	dl CODE_gm_load_title_screen-$01
	dl CODE_gm_fade_to_title_screen-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm0c_level_fadein_and_name-$01
	dl CODE_gm0d_level_fadein_post_pipe_or_door-$01
	dl CODE_gm0e_level_fadein_to_control-$01
	dl CODE_gm0f_run_level-$01
	dl CODE_gm10_victory_cutscene-$01
	dl CODE_gm11_level_death-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm13_prepare_retry_screen-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm15_retry_screen_cutscene-$01
	dl CODE_gm16_world_end_cutscene_load-$01
	dl CODE_gm17_final_cinema_sequence-$01
	dl CODE_gm_load_title_screen-$01
	dl CODE_gm_fade_to_title_screen-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm1b_load_credits-$01
	dl CODE_gm1c_credits_begin-$01
	dl CODE_gm1d_credits-$01
	dl CODE_gm1e_start_select_level_fade-$01
	dl CODE_gm_fade_alt-$01
	dl CODE_gm20_prepare_overworld-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm22_overworld-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm24_overworld_level_progression-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm26_level_score_update-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm28_world_score_flip_cutscene-$01
	dl CODE_gm_fade_alt-$01
	dl CODE_gm2a_load_bonus_game-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm2c_bonus_game-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm2e_main_bandit_minigame-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm30_miniboss_battle-$01
	dl CODE_gm31_fade_to_score_from_boss-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm33_fade_to_midring_restart_screen-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm35_load_restart_from_midring-$01
	dl CODE_gm_retry_level_cutscene_select-$01
	dl CODE_gm_fade_alt-$01
	dl CODE_gm38_load_intro_cutscene-$01
	dl CODE_gm39_intro_cutscene-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm3b_load_retry_screen-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm3d_retry_screen-$01
	dl CODE_gm_retry_level_cutscene_select-$01
	dl CODE_gm3f_load_game_over-$01
	dl CODE_gm40_game_over-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm42_controller_error-$01
	dl CODE_gm_fade_screen_in_out-$01
	dl CODE_gm44_unknown-$01

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_disable_nmi -- mask NMI + auto-joypad, disable HDMA, force PPU into f-blank.
; Raidenthequick: CODE_disable_nmi.  Called before any long DMA-into-VRAM sequence.
;
; INPUTS:   M=8 (writes only 8-bit values to PPU regs).
; OUTPUTS:  none.
; MODIFIES: $4200 = $00 (NMIITIMEN: NMI/IRQ/joypad off); $420C = $00
;           (HDMAEN); $2100 = $8F (INIDISP: force-blank + brightness $0F).
;           A clobbered.
; CALLERS:  CODE_yi_reset; CODE_0082D0 (init_ram_sram); CODE_init_oam_and_bg3_tilemap;
;           many other JSL sites in Bank01/0F/10/17 before DMA bursts.
;-------------------------------------------------------------------------
CODE_008239:
CODE_disable_nmi:                                  ; Raidenthequick: CODE_disable_nmi
	STZ.w !REGISTER_IRQNMIAndJoypadEnableFlags ; mask NMI/IRQ/auto-joypad
	STZ.w !REGISTER_HDMAEnable                ; disable all HDMA channels
	LDA.b #$8F                                ; \ force-blank ($80) + brightness 15
	STA.w !REGISTER_ScreenDisplayRegister     ; /
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_enable_nmi -- enable NMI ($80) + auto-joypad read ($01).
; Raidenthequick: CODE_enable_nmi.  Paired with CODE_disable_nmi around blocking work.
;
; INPUTS:   M=8.
; OUTPUTS:  $4200 = $81 (NMI + auto-joypad). IRQ stays masked here; IRQ enable
;           is rebuilt by IRQ handlers themselves via $4200 = $B1.
; MODIFIES: A clobbered.
; CALLERS:  end of scene-load sequences (Bank01/0F/10 game-mode handlers).
;-------------------------------------------------------------------------
CODE_008245:
CODE_enable_nmi:                                   ; Raidenthequick: CODE_enable_nmi
	LDA.b #$81                                ; NMI on + auto-joypad on
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_init_oam -- kick the SuperFX OAM-init routine (FXCODE_08BD16).
; Raidenthequick: CODE_init_oam.
;
; INPUTS:   none (M-width restored on exit).
; OUTPUTS:  OAM cleared / re-initialised by SuperFX-side code.
; MODIFIES: SuperFX regs $3000-$303F; OAM ($2102+); A/X clobbered.
; CALLERS:  CODE_init_oam_and_bg3_tilemap; many in-level/cutscene init paths
;           (Bank01/0F/17). Always paired with CODE_disable_nmi beforehand.
;-------------------------------------------------------------------------
CODE_00824B:
CODE_init_oam:                                     ; Raidenthequick: CODE_init_oam
	REP.b #$20
	LDX.b #FXCODE_08BD16>>16                  ; \ X = bank of SuperFX OAM-init routine
	LDA.w #FXCODE_08BD16                      ; / A = address (low 16)
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_init_oam_buffer -- kick the SuperFX init-OAM-buffer routine (FXCODE_08B1D8).
; Raidenthequick: CODE_init_oam_buffer.
;
; INPUTS:   none.
; OUTPUTS:  Per-frame OAM staging buffer reset (so sprite drawing starts fresh).
; MODIFIES: WRAM OAM buffer; SuperFX regs; A/X clobbered.
; CALLERS:  every per-frame in-level routine that draws sprites (top of
;           player/sprite handlers in Bank01/02/03), Raphael IRQ-level intro
;           in Bank00 CODE_00C71E.
;-------------------------------------------------------------------------
CODE_008259:
CODE_init_oam_buffer:                              ; Raidenthequick: CODE_init_oam_buffer
	REP.b #$20
	LDX.b #FXCODE_08B1D8>>16
	LDA.w #FXCODE_08B1D8
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_oam_high_buffer_to_table -- compress OAM high buffer into OAM high table via SuperFX (FXCODE_08B289).
; Raidenthequick: CODE_oam_high_buffer_to_table.
;
; INPUTS:   WRAM OAM high buffer populated by per-frame draw routines.
; OUTPUTS:  OAM high table ready for DMA into PPU OAM in NMI.
; MODIFIES: SuperFX regs; A/X clobbered.
; CALLERS:  end-of-frame draw chain (Bank01/0F finalisers).
;-------------------------------------------------------------------------
CODE_008267:
CODE_oam_high_buffer_to_table:                     ; Raidenthequick: CODE_oam_high_buffer_to_table
	REP.b #$20
	LDX.b #FXCODE_08B289>>16
	LDA.w #FXCODE_08B289
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	SEP.b #$20
	RTL

;---------------------------------------------------------------------------

DATA_008275:
	dw $FFFF

;-------------------------------------------------------------------------
; CODE_init_oam_and_bg3_tilemap -- called by routines loading new scenes.
; Raidenthequick: CODE_init_oam_and_bg3_tilemap.
; Sets the tilemap-queue mode ($0127) to "DMA" (3), then disables NMI,
; inits OAM, and tail-calls CODE_prepare_tilemap_dma_queue_l in this bank
; ($00:E37B). The shared body at CODE_008279 lets callers supply an
; alternative $0127 value in A.
;
; INPUTS:   M=8. (Inner CODE_008279 entry: A = queue-mode index for $0127.)
; OUTPUTS:  $0127 written; NMI/HDMA off; OAM init kicked; BG3 tilemap DMA
;           queue prepared for the next NMI to process.
; MODIFIES: $0127, $4200, $420C, $2100, OAM, SuperFX regs, A.
; CALLERS:  scene-load routines in Bank0F/10/17 right before they want to
;           atomic-swap the visible tilemap.
;-------------------------------------------------------------------------
CODE_008277:
CODE_init_oam_and_bg3_tilemap:                     ; Raidenthequick: CODE_init_oam_and_bg3_tilemap
	LDA.b #$03                                ; queue mode: DMA
CODE_008279:
	STA.w $0127                               ; tilemap-queue mode
	JSL.l CODE_disable_nmi                         ; CODE_disable_nmi
	JSL.l CODE_init_oam                         ; CODE_init_oam (SuperFX)
	JML.l CODE_prepare_tilemap_dma_queue_l                         ; -> CODE_prepare_tilemap_dma_queue_l

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_dma_wram_gen_purpose -- general-purpose DMA into WRAM via channel 0.
; Raidenthequick: CODE_dma_wram_gen_purpose.
;
; INPUTS:   M=16; A = transfer size (bytes);
;           $20/$22 = WRAM dest address / bank (writes to $2181 WRAM port);
;           $23/$25 = source address / bank.
; OUTPUTS:  none.
; MODIFIES: DMA channel 0 regs ($4300-$4307); $2181-$2183; $420B
;           (DMA enable). A clobbered.
; CALLERS:  CODE_yi_reset (copying interrupt trampoline + main-RAM code block to
;           WRAM at $7E:0100 and $7E:C000+). Not invoked elsewhere.
;-------------------------------------------------------------------------
CODE_008288:
CODE_dma_wram_gen_purpose:                         ; Raidenthequick: CODE_dma_wram_gen_purpose
	STA.w DMA[$00].SizeLo                     ; transfer count from A
	LDA.b $20                                 ; \ WRAM destination (low+mid)
	STA.w !REGISTER_WRAMAddressLo             ; /
	LDY.b $22                                 ; \ WRAM destination bank
	STY.w !REGISTER_WRAMAddressBank           ; /
	LDA.w #((!REGISTER_ReadOrWriteToWRAMPort&$0000FF)<<8)+$00
	STA.w DMA[$00].Parameters                 ; mode 0, source = $2180 (WRAM port)
	LDA.b $23                                 ; \ source address (low 16)
	STA.w DMA[$00].SourceLo                   ; /
	LDY.b $25                                 ; \ source bank
	STY.w DMA[$00].SourceBank                 ; /
	LDY.b #$01                                ; \ trigger channel 0
	STY.w !REGISTER_DMAEnable                 ; /
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_dma_init_gen_purpose -- DMA-fill an arbitrary WRAM/SRAM range with a single value.
; Raidenthequick: CODE_dma_init_gen_purpose.
; Tricks the Mode-7 multiplier ($2134) into producing a constant byte stream
; by latching M7A = Y, M7B = 1 so M7 result = Y for every read.
;
; INPUTS:   M=16; A = transfer size; Y = fill value (low byte);
;           $20 = destination address (low 16); $22 = destination bank.
; OUTPUTS:  destination range filled with Y; M7A/M7B left dirty.
; MODIFIES: $211B-$211C (M7A/M7B); DMA channel 0 regs; $420B; A, X.
; CALLERS:  CODE_0082D0 (init_ram_sram via CODE_yi_reset); CODE_clear_basic_states
;           (CODE_clear_basic_states, level entry); occasionally called from level-load
;           paths to wipe sprite-slot regions.
;-------------------------------------------------------------------------
CODE_0082AB:
CODE_dma_init_gen_purpose:                         ; Raidenthequick: CODE_dma_init_gen_purpose
	STA.w DMA[$00].SizeLo                     ; transfer count from A
	STY.w !REGISTER_Mode7MatrixParameterA     ; \ M7A_lo = fill value (Y)
	LDX.b #$00                                ; |
	STX.w !REGISTER_Mode7MatrixParameterA     ; / M7A_hi = 0  -> M7A = Y
	INX
	STX.w !REGISTER_Mode7MatrixParameterB     ;   M7B = 1     -> product = Y * 1 = Y per read
	LDA.w #((!REGISTER_PPUMultiplicationProductLo&$0000FF)<<8)+$80
	STA.w DMA[$00].Parameters                 ;   mode $80: fixed source
	LDA.b $20
	STA.w DMA[$00].SourceLo                   ;   source low 16 (actually destination -- channel uses CPU bus side)
	LDX.b $22
	STX.w DMA[$00].SourceBank
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; init_ram_sram (CODE_0082D0) -- Init RAM/SRAM at boot. Called once from CODE_yi_reset.
; Sequence: $7E:0000-$7E:00FF (DP), $7E:0200-$7E:BFFF (WRAM body), $7F:0000-$7F:FFFF
; (ExRAM), $70:0000-$70:7BFF (SRAM minus save-file area + checksums + backups).
; Then writes two SuperFX-control sentinels at $7E:4002 / $7E:4800.
;
; INPUTS:   none.
; OUTPUTS:  All listed WRAM/SRAM ranges zeroed; $7E:4002 = $FFFF;
;           $7E:4800 = $4802 (tilemap DMA queue end-sentinel).
; MODIFIES: $20/$22 (dest pointer scratch); A, X, Y; M7A/M7B (via
;           CODE_dma_init_gen_purpose). M-width left 8-bit on exit.
; CALLERS:  CODE_yi_reset only.
;-------------------------------------------------------------------------
CODE_0082D0:                                  ; Raidenthequick: CODE_0082D0 (init_ram_sram)
	JSL.l CODE_disable_nmi                         ; CODE_disable_nmi (keep PPU clean during fill)
	REP.b #$20
	LDY.b #$00                                ; Y = fill value (zero)
	STZ.b $20
	STZ.b $22                                 ; dest = $00:0000
	LDA.w #$0100                              ; size = $0100 -> zero $7E:0000..00FF
	JSL.l CODE_dma_init_gen_purpose                         ; CODE_dma_init_gen_purpose
	LDA.w #$7E0200
	STA.b $20
	LDX.b #$7E0200>>16
	STX.b $22
	LDA.w #$BE00
	JSL.l CODE_dma_init_gen_purpose
	STZ.b $20
	LDX.b #$7F0000>>16
	STX.b $22
	LDA.w #$0000
	JSL.l CODE_dma_init_gen_purpose
	LDX.b #$700000>>16
	STX.b $22
	LDA.w #$7C00
	JSL.l CODE_dma_init_gen_purpose
	LDA.w #$FFFF
	STA.l $7E4002
	LDA.w #$4802
	STA.l $7E4800
	SEP.b #$20
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_clear_basic_states -- wipe gamemode-$0F active state on level entry/restart.
; Raidenthequick: CODE_clear_basic_states.
; Keeps level settings, item memory, collectables and save state; just zeroes:
;   $7E:0035-$7E:00EF   (most of DP scratch)
;   $7E:093C-$7E:11B6   (sprite slot bookkeeping)
;   $70:0092-$70:01F7   (save-file scratch / camera)
;   $70:1E08-$70:1FEF   (SRAM scratch)
;   $70:2604-$70:77FF   (SRAM buffers)
; Each block is filled via CODE_dma_init_gen_purpose with Y=0 (set on entry).
;
; INPUTS:   none (M-width may be either; ends in M=8).
; OUTPUTS:  Listed ranges zeroed; level-load may begin fresh.
; MODIFIES: $20-$22 scratch; A, X, Y; M7A/M7B; DMA channel 0.
; CALLERS:  level-load entry points in Bank01/0F (game-mode $0C/$0E) and
;           pause/retry transitions.
;-------------------------------------------------------------------------
CODE_00831C:
CODE_clear_basic_states:                           ; Raidenthequick: CODE_clear_basic_states
	REP.b #$20
	LDY.b #$000035>>16                        ; \ Y = 0 (fill value)
	STZ.b $21                                 ; / dest bank high byte stays $00 / $70 per block
	LDA.w #$000035
	STA.b $20                                 ; dest = $7E:0035
	LDA.w #$00CB
	JSL.l CODE_dma_init_gen_purpose
	LDA.w #$00093C
	STA.b $20
	LDA.w #$087A
	JSL.l CODE_dma_init_gen_purpose
	LDA.w #$006092
	STA.b $20
	LDA.w #$0166
	JSL.l CODE_dma_init_gen_purpose
	LDA.w #$007E08
	STA.b $20
	LDA.w #$01E8
	JSL.l CODE_dma_init_gen_purpose
	LDA.w #$702604
	STA.b $20
	LDX.b #$702604>>16
	STX.b $22
	LDA.w #$51FC
	JSL.l CODE_dma_init_gen_purpose
	SEP.b #$20
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_execute_ptr -- pull-callsite jump-table dispatcher (16-bit pointers).
; Raidenthequick: CODE_execute_ptr.
; The caller does `JSR CODE_execute_ptr` then immediately follows that with a
; dw[] table; the routine pulls the return PC, indexes into that inline table
; using A as the entry number (max 256), and jumps to the resolved pointer.
;
; INPUTS:   M=8 on entry; A = entry index (0..255); inline table immediately
;           follows the JSR (does NOT return to caller).
; OUTPUTS:  Jumps to table[A]; the inline table is never executed inline.
; MODIFIES: $00-$02 (pointer scratch); $03 (preserved Y); A destroyed;
;           X preserved; Y preserved (saved/restored via $03).
; CALLERS:  many sub-state machines (level-init phases, cutscene step
;           tables, fade-mode submenus in Bank01/0F/10/17).
;-------------------------------------------------------------------------
CODE_008365:
CODE_execute_ptr:                                  ; Raidenthequick: CODE_execute_ptr
	STY.b $03                                 ; preserve Y
	PLY                                       ; \ caller's return PC hi+bank
	STY.b $00                                 ; / build ptr-to-table at $00..02
	REP.b #$30
	AND.w #$00FF                              ; entry index (cap 256)
	ASL                                       ; *2 (word-stride table)
	TAY
	PLA
	STA.b $01                                 ; complete the table-base pointer
	INY                                       ; skip past the JSR's own byte
	LDA.b [$00],y                             ; load the target address
	STA.b $00
	SEP.b #$30
	LDY.b $03                                 ; restore Y
	JMP.w [$0000]                             ; -> table entry

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; ADDR_execute_ptr_long -- pull-callsite jump-table dispatcher (24-bit pointers).
; Raidenthequick: ADDR_execute_ptr_long.
; Same shape as CODE_execute_ptr but the inline table holds 3-byte entries;
; the routine swaps in the target bank via PHB+PHA+PLB before the JMP [].
;
; INPUTS:   M=8 on entry; A = entry index; inline table = dl ptr,...
;           immediately follows the JSR.
; OUTPUTS:  DBR set to target bank; jumps to table[A] via JMP ($0000).
; MODIFIES: $00-$01 (pointer); $02-$04 (caller PC scratch); $05 (saved Y);
;           A destroyed; X preserved; Y preserved.
; CALLERS:  cross-bank dispatch jumps (cutscene/credit step tables).
;-------------------------------------------------------------------------
ADDR_008380:
ADDR_execute_ptr_long:                             ; Raidenthequick: ADDR_execute_ptr_long
	STY.b $05                                 ; preserve Y
	PLY                                       ; \ caller PC -> $02..04 pointer
	STY.b $02                                 ; /
	REP.b #$30
	AND.w #$00FF                              ; entry index
	STA.b $03
	ASL                                       ; \ *3 stride for 24-bit table
	ADC.b $03                                 ; /
	TAY
	PLA
	STA.b $03
	INY
	LDA.b [$02],y                             ; lo+mid of target
	STA.b $00
	INY
	LDA.b [$02],y                             ; rereads middle + bank byte in A.hi
	STA.b $01
	XBA                                       ; A = bank
	SEP.b #$30
	PHB
	PHA
	PLB                                       ; DBR = target bank
	LDY.b $05                                 ; restore Y
	JMP.w [$0000]                             ; -> table entry

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_gm1e_start_select_level_fade -- gamemode $1E (start+select level-fade-out).
; Raidenthequick: CODE_gm1e_start_select_level_fade.
; Steps the screen brightness toward DATA_fade_limit[fade-type]; when complete,
; toggles fade-type and forces game mode to $20 (prepare overworld).
;
; INPUTS:   $0200 = INIDISP brightness mirror (low nibble used); $0201 =
;           fade direction (0 = fading in, 1 = fading out).
; OUTPUTS:  $0200 stepped by +/-1 toward limit; on completion, $0201 toggled
;           and !RAM_YI_Global_CurrentGameMode forced to $20.
; MODIFIES: A, X; CurrentGameMode; $0200/$0201.
; CALLERS:  DATA_game_mode_pointers entry $1E only.
;-------------------------------------------------------------------------
CODE_0083A8:
CODE_gm1e_start_select_level_fade:                 ; Raidenthequick: CODE_gm1e_start_select_level_fade
	LDX.w $0201                               ; fade-in/out type (0 = in, 1 = out)
	LDA.w $0200                               ; current INIDISP brightness mirror
	AND.b #$0F
	CMP.w DATA_fade_limit,x                       ; reached DATA_fade_limit?
	BNE.b CODE_gm_fade_screen_in_out_add_fade                         ;   no -> add fade delta
	TXA
	EOR.b #$01                                ; toggle fade-type
	AND.b #$01
	STA.w $0201
	LDA.b #!Define_YI_GameMode20              ; jump to gamemode $20 (prepare_overworld)
	STA.w !RAM_YI_Global_CurrentGameMode
	BRA.b CODE_gm_fade_screen_in_out_ret

DATA_0083C4:
DATA_fade_amount:                                  ; Raidenthequick: DATA_fade_amount   (+1/-1 per frame)
	db $01,$FF

DATA_0083C6:
DATA_fade_limit:                                   ; Raidenthequick: DATA_fade_limit    ($0F = full bright, $00 = dark)
	db $0F,$00

;-------------------------------------------------------------------------
; CODE_gm_fade_screen_in_out -- the workhorse fade game mode used by many entries
; in DATA_game_mode_pointers ($04 $06 $0B $12 $14 $1A $21 $23 $25 $27 $2B $2D $2F
; $32 $34 $3A $3C $41 $43). Steps INIDISP brightness toward DATA_fade_limit; when
; complete, advances to the next game mode.
; CODE_0083C8 is an "unused entry" -- pushes DBR=$00 then falls through into the
; main body at CODE_gm_fade_screen_in_out (the real entry the dispatch table jumps to).
;
; INPUTS:   $0201 = fade direction; $0200 = brightness mirror.
; OUTPUTS:  $0200 stepped by +/-1; on completion $0201 toggled and
;           !RAM_YI_Global_CurrentGameMode INC'd.
; MODIFIES: A, X; CurrentGameMode; $0200/$0201; DBR (saved/restored via PLB).
; CALLERS:  DATA_game_mode_pointers entries listed above; CODE_gm_fade_alt and
;           CODE_gm16_world_end_cutscene_load tail-branch here.
;-------------------------------------------------------------------------
CODE_0083C8:
	PHB
	LDA.b #DATA_fade_amount>>16
	PHA
	PLB
CODE_0083CD:
CODE_gm_fade_screen_in_out:                        ; Raidenthequick: CODE_gm_fade_screen_in_out
	LDX.w $0201                               ; fade type
	LDA.w $0200                               ; INIDISP mirror
	AND.b #$0F                                ; isolate brightness
	CMP.w DATA_fade_limit,x                       ; reached limit?
	BNE.b CODE_gm_fade_screen_in_out_add_fade                         ; no -> add delta
	TXA
	EOR.b #$01                                ; \ toggle fade type
	AND.b #$01                                ; /
	STA.w $0201
	INC.w !RAM_YI_Global_CurrentGameMode      ; advance to next game mode
	BRA.b CODE_gm_fade_screen_in_out_ret

CODE_0083E7:
CODE_gm_fade_screen_in_out_add_fade:               ; Raidenthequick: .add_fade
	CLC
	ADC.w DATA_fade_amount,x                       ; +1 or -1 per frame
	STA.w $0200
CODE_0083EE:
CODE_gm_fade_screen_in_out_ret:                    ; Raidenthequick: .ret
	PLB
	RTL

;-------------------------------------------------------------------------
; CODE_gm_fade_alt -- slowed fade variant; ticks every 3 frames.
; Raidenthequick: CODE_gm_fade_alt.  Used by modes $02 $08 $1F $29 $37.
;
; INPUTS:   $0202 = transition-step countdown timer; $0200/$0201 as above.
; OUTPUTS:  Calls CODE_gm_fade_screen_in_out once every 3 frames (reload = 2).
; MODIFIES: A; $0202; everything CODE_gm_fade_screen_in_out touches.
; CALLERS:  DATA_game_mode_pointers entries $02 $08 $1F $29 $37.
;-------------------------------------------------------------------------
CODE_0083F0:
CODE_gm_fade_alt:                                  ; Raidenthequick: CODE_gm_fade_alt
	DEC.w $0202                               ; transition-step timer
	BPL.b CODE_gm_fade_screen_in_out_ret                         ; still waiting -> return
	LDA.b #$02                                ; reload to 2
	STA.w $0202
	BRA.b CODE_gm_fade_screen_in_out                         ; tick the normal fade

;-------------------------------------------------------------------------
; CODE_gm16_world_end_cutscene_load -- gamemode $16 (load end-of-world cutscene).
; Raidenthequick: CODE_gm16_world_end_cutscene_load.  Slow-tick fade (reload 8).
;
; INPUTS:   $0202; $0200/$0201.
; OUTPUTS:  As CODE_gm_fade_screen_in_out but at 1/8 rate.
; MODIFIES: A; $0202.
; CALLERS:  DATA_game_mode_pointers entry $16.
;-------------------------------------------------------------------------
CODE_0083FC:
CODE_gm16_world_end_cutscene_load:                 ; Raidenthequick: CODE_gm16_world_end_cutscene_load
	DEC.w $0202
	BPL.b CODE_gm_fade_screen_in_out_ret
	LDA.b #$08                                ; slower reload
	STA.w $0202
	BRA.b CODE_gm_fade_screen_in_out

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_random_number_gen -- accumulate H/V counter values into the RNG seed.
; Raidenthequick: CODE_random_number_gen.
; Reads $2137 ($SLHV latch), discards $213F flag toggle, then adds H counter
; to the existing 16-bit RNG word. Output lives at !EXRAM_YI_Global_RNGOutputLo.
;
; INPUTS:   PPU H/V counters; !EXRAM_YI_Global_RNGOutputLo (current seed).
; OUTPUTS:  !EXRAM_YI_Global_RNGOutputLo += H-counter (low + high bytes).
;           Output is the 16-bit "low" word in ExRAM.
; MODIFIES: A; PPU latch state ($2137 read); processor flags preserved
;           (PHP/PLP wrap).
; CALLERS:  every routine that needs a fresh random number -- ambient
;           sprite spawners (Bank00 CODE_spawn_ambient_sprite uses output), sprite
;           AI in Bank02-0E, world-map per-frame ticker.
;-------------------------------------------------------------------------
CODE_008408:
CODE_random_number_gen:                            ; Raidenthequick: CODE_random_number_gen
	PHP
	SEP.b #$20
	LDA.w !REGISTER_SoftwareLatchForHVCounter ;   latch H/V counters
	LDA.w !REGISTER_PPUStatusFlag2            ;   set $213C to read "low byte" next
	REP.b #$20
	LDA.w !REGISTER_HCounter                  ;   H counter as entropy
	CLC
	ADC.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	STA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	PLP
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_SPC700Upload -- bootstrapped SPC-side data uploader.
; Raidenthequick: CODE_SPC700Upload.
; See also: ys_init.asm (the parallel boot-time SPC bring-up path).
; Implements the standard "IPL-style" handshake the SPC engine speaks once it
; is resident:
;   * wait for $2140 == $BBAA (ready)
;   * send $CC + first block address+size, then validate per-byte via $2140
;   * for each block, transfer 2 bytes/iter (interleaved low+high in A), confirm
;     validation byte advance, repeat
;   * end-of-list (zero-address word) tells the SPC to start executing
; Block list comes from $0000-$0010 in DP (set up by CODE_upload_music_data).
;
; INPUTS:   DP $00..$01 = pointer to first block source; $0003-$000B =
;           array of up to 3 follow-on (24-bit ptr) blocks; $000C = count
;           of follow-on blocks remaining. (All laid out by CODE_upload_music_data.)
; OUTPUTS:  SPC700 receives all blocks then begins executing the SPC engine.
;           APU ports $2140-$2143 cleared on exit.
; MODIFIES: A, X, Y; APU ports. Processor flags preserved (PHP/PLP wrap).
;           Runs under SEI established by caller (CODE_set_level_music).
; CALLERS:  CODE_upload_music_data via JSR (CODE_SPC700Upload is RTS, not RTL).
;-------------------------------------------------------------------------
CODE_00841F:
CODE_SPC700Upload:                                 ; Raidenthequick: CODE_SPC700Upload
	PHP                                       ; preserve processor flags
	REP.b #$30                                ; 16-bit A/X/Y
	LDY.w #$0000
	LDA.w #$BBAA                              ; \ "ready" handshake word
CODE_008428:
	CMP.w !REGISTER_APUPort0                  ; | wait for SPC to be ready
	BNE.b CODE_008428                         ; /
	SEP.b #$20                                ;   8-bit A
	LDA.b #$CC                                ; \ start-block-upload byte
	BRA.b CODE_008459                         ; / -> .send_SPC_block

CODE_008433:
	LDA.b [$00],y
	INY
	XBA
	LDA.b #$00
	BRA.b CODE_008446

CODE_00843B:
	XBA
	LDA.b [$00],y
	INY
	XBA
CODE_008440:
	CMP.w !REGISTER_APUPort0
	BNE.b CODE_008440
	INC
CODE_008446:
	REP.b #$20
	STA.w !REGISTER_APUPort0
	SEP.b #$20
	DEX
	BNE.b CODE_00843B
CODE_008450:
	CMP.w !REGISTER_APUPort0
	BNE.b CODE_008450
CODE_008455:
	ADC.b #$03
	BEQ.b CODE_008455
CODE_008459:
	PHA
	REP.b #$20
	LDA.b [$00],y
	BNE.b CODE_00847C
	DEC.w $000C
	BMI.b CODE_00847C
	LDA.w $000C
	ASL
	ADC.w $000C
	TAY
	LDA.w $0003,y
	STA.b $00
	LDA.w $0004,y
	STA.b $01
	LDY.w #$0000
	LDA.b [$00],y
CODE_00847C:
	INY
	INY
	TAX
	LDA.b [$00],y
	INY
	INY
	STA.w !REGISTER_APUPort2
	SEP.b #$20
	CPX.w #$0001
	LDA.b #$00
	ROL
	STA.w !REGISTER_APUPort1
	ADC.b #$7F
	PLA
	STA.w !REGISTER_APUPort0
CODE_008497:
	CMP.w !REGISTER_APUPort0
	BNE.b CODE_008497
	BVS.b CODE_008433
	STZ.w !REGISTER_APUPort0
	STZ.w !REGISTER_APUPort1
	STZ.w !REGISTER_APUPort2
	STZ.w !REGISTER_APUPort3
	PLP
	RTS

;-------------------------------------------------------------------------
; DATA_SPC_ptr -- 20-entry pointer table: SPC data block sources.
; Raidenthequick: DATA_SPC_ptr.
; Indexed by entries in DATA_spc_data_blocks; one pointer per data block. The
; block id named in DATA_spc_data_blocks indexes this table as a RAW BYTE offset
; (id = entry*3+1, since each row is a 3-byte `dl`), so the valid block ids are
; $01,$04,$07,...,$3A -- the `; $XX` tags below are those ids. Content roles for
; $1C/$22/$25/$2B are confirmed (block-set table + ROM-offset cross-check, see
; docs/enginecore.md 2.3); the rest are listed by id only.
;-------------------------------------------------------------------------
DATA_0084AC:
DATA_SPC_ptr:                                      ; Raidenthequick: DATA_SPC_ptr
	dl DATA_4E0000                            ; $01
	dl DATA_4E169C                            ; $04
	dl DATA_4E23BF                            ; $07
	dl DATA_4E2C39                            ; $0A
	dl DATA_4E38D2                            ; $0D
	dl DATA_4ED0FE                            ; $10
	dl DATA_4ED5D0                            ; $13
	dl DATA_4EE279                            ; $16
	dl DATA_4EEC85                            ; $19
	dl DATA_4F4122                            ; $1C overworld music + song $07 (bonus/defeat) + goal-ring fanfare; OVERWORLD-EXCLUSIVE (only block set row 2, music-setting $12 uploads it)
	dl DATA_4F5C48                            ; $1F
	dl DATA_4F6E5A                            ; $22 shared sample block for the map/overworld + intro/castle music sets (settings $02/$11/$12)
	dl DATA_4F82E6                            ; $25 base/"default" music block -- present in nearly every level music set (block-set rows 1-10)
	dl DATA_4FFCB2                            ; $28
	dl YI_SPCEngine                           ; $2B the SPC700 driver program itself -- block-set row 0 = "engine only", uploaded by a reset (X=$10) and settings $0E/$0F
	dl DATA_4F33F0                            ; $2E
	dl DATA_4EFEC1                            ; $31
	dl DATA_4F205D                            ; $34
	dl DATA_4E3E90                            ; $37
	dl DATA_4EBBEC                            ; $3A

;-------------------------------------------------------------------------
; DATA_spc_data_blocks -- 4-byte rows; each row = a "block set" (3 block indexes
; into DATA_SPC_ptr followed by $FF terminator).
; Raidenthequick: DATA_spc_data_blocks.
;-------------------------------------------------------------------------
DATA_0084E8:
DATA_spc_data_blocks:                              ; Raidenthequick: DATA_spc_data_blocks
	db $2B,$FF,$FF,$FF,$25,$22,$2E,$FF,$25,$22,$1C,$FF,$25,$19,$13,$FF
	db $25,$16,$10,$FF,$25,$16,$0D,$FF,$25,$22,$28,$FF,$25,$16,$0A,$FF
	db $25,$19,$07,$FF,$25,$19,$1F,$FF,$25,$01,$04,$FF,$31,$34,$FF,$FF
	db $37,$3A,$FF,$FF

;-------------------------------------------------------------------------
; DATA_item_denial_table -- per-music-track pause-menu item disable flag.
; $00 = items enabled, $01 = disabled, $FF = inherit (no change).
; Raidenthequick: DATA_item_denial_table.
;-------------------------------------------------------------------------
DATA_00851C:
DATA_item_denial_table:                            ; Raidenthequick: DATA_item_denial_table
	db $00,$00,$00,$01,$00,$01,$00,$01,$01,$01,$00,$00,$01,$00,$00,$00
	db $FF,$00

;-------------------------------------------------------------------------
; DATA_spc_block_set_indexes -- per-level-music-ID -> DATA_spc_data_blocks row index.
; First byte is unused/sentinel; indexing is 1-based on the level header value.
; Raidenthequick: DATA_spc_block_set_indexes.
;-------------------------------------------------------------------------
DATA_00852E:
DATA_spc_block_set_indexes:                        ; Raidenthequick: DATA_spc_block_set_indexes
	; SMWC tweak $00853D: byte at index $0F (music header setting E in 1-based
	; addressing) -- change to [04] (and pair with $01B259->[02]) to make header E
	; play "Welcome to Yoshi's Island" music. Default [00] above (end of first row).
	db $FF,$0C,$10,$18,$1C,$14,$1C,$20,$24,$24,$24,$28,$28,$2C,$1C,$00
	db $00,$00,$04,$08,$30

;-------------------------------------------------------------------------
; CODE_set_level_music / CODE_upload_music_data -- pick a music track via the level
; header value (or arg X), look up its DATA_spc_block_set_indexes row, diff
; against the currently-resident SPC block set, upload any new blocks, then
; reset SPC port state. Used by reset (X=$10 -> "engine only").
; Raidenthequick: CODE_set_level_music / CODE_upload_music_data.
;
; INPUTS:   X = music index (only at CODE_set_level_music entry); otherwise the
;           value already cached at !RAM_YI_Level_LevelHeaderMusicSettingLo.
;           $0203 = previous SPC block-set index (for diffing).
; OUTPUTS:  !RAM_YI_Level_CantUseItemsFlagLo set per DATA_item_denial_table;
;           up to 3 new blocks uploaded via CODE_SPC700Upload; APU mirrors and
;           sound queue cleared (PlayMusicLo, PreviousMusicLo, etc).
; MODIFIES: A, X, Y; SEI/CLI bracket the SPC upload critical section so
;           NMI doesn't preempt the handshake.
; CALLERS:  CODE_yi_reset (X=$10 = SPC-engine-only); per-level music-change
;           routines in Bank10 (UnpackLevelHeader chain).
; NOTE:     The diff means $0207..$020A (and $0203) track only the LAST upload's
;           block IDs -- NOT a snapshot of ARAM. Each block lands in a fixed,
;           non-overlapping ARAM region and an $FF slot = "keep what's there", so
;           ARAM accumulates every block set loaded along the player's route. A
;           block the overworld uploads persists into later levels. Real fallout:
;           music $07 (bonus/defeat theme) lives in an overworld-only block, so
;           dying after a cold warp/level-jump that skips the map hangs the SPC
;           driver. See docs/enginecore.md 2.3 + trace-harness spike-audio/PLAN.
;-------------------------------------------------------------------------
CODE_008543:
CODE_set_level_music:                              ; Raidenthequick: CODE_set_level_music
	STX.w !RAM_YI_Level_LevelHeaderMusicSettingLo
CODE_008546:
CODE_upload_music_data:                            ; Raidenthequick: CODE_upload_music_data
	LDX.w !RAM_YI_Level_LevelHeaderMusicSettingLo
	LDA.l DATA_item_denial_table,x
	BMI.b CODE_008552
	STA.w !RAM_YI_Level_CantUseItemsFlagLo
CODE_008552:
	INX
	CPX.w $0203
	BNE.b CODE_008559
	RTL

CODE_008559:
	STX.w $0203
	STZ.w $0205
	LDA.l DATA_spc_block_set_indexes,x
	TAX
	STZ.b $0C
	STZ.b $0D
	STZ.b $0E
	LDY.b #$00
CODE_00856C:
	LDA.l DATA_spc_data_blocks,x
	CMP.w $0207,y
	BEQ.b CODE_00859F
	STA.w $0207,y
	CMP.b #$FF
	BEQ.b CODE_00859F
	INC.b $0C
	PHX
	PHY
	TAX
	LDY.b $0E
	LDA.l DATA_0084AC-$01,x
	STA.w $0000,y
	LDA.l DATA_0084AC,x
	STA.w $0001,y
	LDA.l DATA_0084AC+$01,x
	STA.w $0002,y
	INY
	INY
	INY
	STY.b $0E
	PLY
	PLX
CODE_00859F:
	INX
	INY
	CPY.b #$04
	BCC.b CODE_00856C
	DEC.b $0C
	BMI.b CODE_0085B3
	SEI
	LDA.b #$FF
	STA.w !REGISTER_APUPort0
	JSR.w CODE_00841F
	CLI
CODE_0085B3:
	LDX.b #$03
CODE_0085B5:
	STZ.w !REGISTER_APUPort0,x
	DEX
	BPL.b CODE_0085B5
	REP.b #$20
	STZ.w !RAM_YI_Global_PlayMusicLo
	STZ.w !RAM_YI_Global_PreviousMusicLo
	STZ.w !RAM_YI_Global_PlaySoundHighPriorityLo
	STZ.w !RAM_YI_Global_PreviousHighPrioritySoundLo
	STZ.w !RAM_YI_Global_SoundQueueSizeLo
	STZ.w !RAM_YI_Global_SoundQueue
	SEP.b #$20
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_push_sound_queue -- long-callable; appends a sound ID (in A) to the
; sound-FX queue at !RAM_YI_Global_SoundQueue.
; Raidenthequick: CODE_push_sound_queue.
;
; INPUTS:   M=8/16 (only low byte read); A = sound ID;
;           !RAM_YI_Global_SoundQueueSizeLo = current queue length.
; OUTPUTS:  Sound ID appended; queue size incremented.
; MODIFIES: A clobbered, Y clobbered; SoundQueue / SoundQueueSize.
; CALLERS:  hundreds (every sprite collision / item effect / cutscene tick).
;           See also CODE_push_sound_queue_pres_x for the X-preserving
;           DP-addressing variant used in tight per-frame paths.
;-------------------------------------------------------------------------
CODE_0085D2:
CODE_push_sound_queue:                             ; Raidenthequick: CODE_push_sound_queue
	LDY.w !RAM_YI_Global_SoundQueueSizeLo     ; current queue size = index
	STA.w !RAM_YI_Global_SoundQueue,y         ; append sound ID
	INC.w !RAM_YI_Global_SoundQueueSizeLo     ; bump count
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; V1.0-only sprite handler bodies inlined here (at $00:85DC-$00:89CB).
; Raidenthequick names: init_kamek_OH_MY / main_kamek_OH_MY / init_background_shyguy
;                       / main_background_shyguy / init_skinny_platform / main_skinny_platform.
; Under V1.1 (ROM_YI_U2) the equivalent code was moved out of bank $00; the
; framework expands the corresponding ROUTINE_YI_* macros from yi/Routines/
; to keep bank-$00 byte-equivalent across versions.
;-------------------------------------------------------------------------
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
else
	%ROUTINE_YI_NorSpr053_KamekSayingOhMy($0085DC)   ; init_kamek_OH_MY / main_kamek_OH_MY
	%ROUTINE_YI_NorSpr0AA_BackgroundShyguy($0086E9)  ; init_background_shyguy / main_background_shyguy
	%ROUTINE_YI_NorSpr03E_ThinPlatform($00878A)      ; init_skinny_platform / main_skinny_platform
endif

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; DATA_ambient_sprite_routines -- 120-entry dispatch table for the ambient-sprite
; system (water splashes, smoke puffs, sparkles, ground-pound dust, minigame
; effects, etc).  Each entry is a 16-bit RTL-style address-1 pointing at one
; of the ambient_* routines defined further below in this bank.
; Raidenthequick: DATA_ambient_sprite_routines.
; Driven by CODE_handle_ambient_sprites at $00:8AB6 once per frame.
;-------------------------------------------------------------------------
DATA_0089CC:
DATA_ambient_sprite_routines:                      ; Raidenthequick: DATA_ambient_sprite_routines
	dw CODE_ambient_water_splash_transition-$01                        ; $00 CODE_ambient_water_splash_transition
	dw CODE_ambient_water_splash_swimming-$01                        ; $01 CODE_ambient_water_splash_swimming
	dw CODE_ambient_bubble_in_water-$01                        ; $02 CODE_ambient_bubble_in_water
	dw CODE_ambient_eggshell-$01                        ; $03 CODE_ambient_eggshell
	dw CODE_ambient_small_bopping_ani-$01
	dw CODE_ambient_score_sprites-$01
	dw CODE_008DB2-$01
	dw CODE_008DE7-$01
	dw CODE_008DF8-$01
	dw CODE_008E16-$01
	dw CODE_008E37-$01
	dw CODE_008E5E-$01
	dw CODE_008E7E-$01
	dw CODE_008EEF-$01
	dw CODE_008EFE-$01
	dw CODE_008F0B-$01
	dw CODE_008F3B-$01
	dw CODE_008F6A-$01
	dw CODE_008F9B-$01
	dw CODE_008FD2-$01
	dw CODE_009007-$01
	dw CODE_009028-$01
	dw CODE_009099-$01
	dw CODE_0090BA-$01
	dw CODE_0090C3-$01
	dw CODE_ambient_oam_shrink_flush-$01
	dw CODE_0090F6-$01
	dw CODE_00912D-$01
	dw CODE_009154-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_00917B-$01
	dw CODE_0091A0-$01
	dw CODE_0091C7-$01
	dw CODE_00921A-$01
	dw CODE_009254-$01
	dw CODE_00927D-$01
	dw CODE_0092EE-$01
	dw CODE_009376-$01
	dw CODE_0093A4-$01
	dw CODE_0093DE-$01
	dw CODE_009433-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_tile_dec_stride_3-$01
	dw CODE_ambient_tile_dec_stride_4-$01
	dw CODE_ambient_main_stomp_puff-$01
	dw CODE_ambient_main_stomp_puff_physics_variant-$01
	dw CODE_ambient_tile_dec_stride_4-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_tile_dec_stride_3-$01
	dw CODE_00A7DA-$01
	dw CODE_ambient_tile_dec_stride_2-$01
	dw CODE_00961B-$01
	dw CODE_ambient_tile_dec_stride_2-$01
	dw CODE_009646-$01
	dw CODE_0095CC-$01
	dw CODE_ambient_tile_dec_stride_2-$01
	dw CODE_00986D-$01
	dw CODE_00986D-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_tile_dec_stride_8-$01
	dw CODE_00986D-$01
	dw CODE_ambient_tile_dec_stride_6-$01
	dw CODE_ambient_tile_dec_stride_6-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_tile_dec_stride_3-$01
	dw CODE_009416-$01
	dw CODE_ambient_main_wandering_companion-$01
	dw CODE_009B13-$01
	dw CODE_ambient_tile_dec_stride_2-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_tile_dec_stride_2-$01
	dw CODE_ambient_tile_dec_stride_2-$01
	dw CODE_ambient_tile_dec_stride_4-$01
	dw CODE_009B55-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_009B88-$01
	dw CODE_009BBC-$01
	dw CODE_009BE3-$01
	dw CODE_009C1D-$01
	dw CODE_009E92-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_tile_dec_stride_1-$01
	dw CODE_00A193-$01
	dw CODE_00A193-$01
	dw CODE_00A551-$01
	dw CODE_00A56F-$01
	dw CODE_00A59A-$01
	dw CODE_ambient_main_wandering_companion-$01
	dw CODE_00A6A9-$01
	dw CODE_00A6CE-$01
	dw CODE_00A835-$01
	dw CODE_00A6A9-$01
	dw CODE_00A726-$01
	dw CODE_009B55-$01
	dw CODE_00A759-$01
	dw CODE_00A776-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_00A78D-$01
	dw CODE_00A7A4-$01
	dw CODE_00A7F7-$01
	dw CODE_ambient_tile_dec_stride_2-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_00A80E-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_coin_get-$01
	dw CODE_00921A-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_ambient_freeze_only_stub-$01
	dw CODE_0098AC-$01
	dw CODE_ambient_main_bonus_1up_jackpot_head-$01
	dw CODE_ambient_main_bonus_1up_regular_head-$01
	dw CODE_ambient_main_bonus_1up_popup_tail-$01
	dw CODE_ambient_main_bonus_1up_fade_final-$01

;-------------------------------------------------------------------------
; CODE_handle_ambient_sprites -- per-frame driver for ambient-sprite slots.
; Raidenthequick: CODE_handle_ambient_sprites.
; Iterates 60 ambient-sprite slots (X = $3C down to 0); for each live slot
; (existence flag != 0), dispatches via CODE_execute_ambient_sprite_routine
; which indexes DATA_ambient_sprite_routines using the slot's routine-ID byte.
; $0B8F is the "frozen-this-frame" combined flag (used by individual ambient
; routines to skip their physics update).
;
; INPUTS:   AmbSpr SpriteExistsFlag / SpriteID arrays at 60 slots (stride 4);
;           FreezeSpritesFlag, TouchedFuzzyMosaicTimerLo, ItemBeingUsed.
; OUTPUTS:  $0B8F = combined freeze mask; per-slot routines invoked.
; MODIFIES: $0B8F; X (used as slot cursor); DBR pushed/popped.
; CALLERS:  per-frame in-level sprite tick (Bank0F game-mode 0F handler).
;-------------------------------------------------------------------------
CODE_008AB6:
CODE_handle_ambient_sprites:                       ; Raidenthequick: CODE_handle_ambient_sprites
	PHB
	PHK
	PLB                                       ; DBR = $00 for direct dispatch
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	ORA.w !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
	ORA.w !RAM_YI_Level_ItemBeingUsed
	STA.w $0B8F                               ; combined "freeze sprite logic this frame" mask
	LDX.b #$3C                                ; X = top slot (60)
CODE_008AC7:
	LDY.w !EXRAM_YI_Level_AmbSpr_SpriteExistsFlag|!EXRAMBankMirror,x
	BEQ.b CODE_008ACF
	JSR.w CODE_execute_ambient_sprite_routine
CODE_008ACF:
	DEX
	DEX
	DEX
	DEX
	BPL.b CODE_008AC7
	PLB
	RTL

;-------------------------------------------------------------------------
; CODE_execute_ambient_sprite_routine -- index DATA_ambient_sprite_routines by slot ID
; and push the routine address so a subsequent RTS jumps to it.
; Raidenthequick: CODE_execute_ambient_sprite_routine.
;
; INPUTS:   X = slot index (stride 4); AmbSpr SpriteID byte at slot.
; OUTPUTS:  pushes target address-1; the RTS at end performs the jump.
; MODIFIES: A; pushes 2 bytes to stack (consumed by RTS).
; CALLERS:  CODE_handle_ambient_sprites loop only.
;-------------------------------------------------------------------------
CODE_008AD7:
CODE_execute_ambient_sprite_routine:               ; Raidenthequick: CODE_execute_ambient_sprite_routine
	LDA.w !EXRAM_YI_Level_AmbSpr_SpriteID|!EXRAMBankMirror,x
	ASL                                       ; *2 for word-stride table
	REP.b #$10
	TAY
	LDA.w DATA_ambient_sprite_routines-(!Define_YI_AmbSpr1BA*$02),y
	SEP.b #$10
	PHA                                       ; push handler address-1
	RTS                                       ; -> handler

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_check_ambient_sprite_freeze -- guard called at the start of many ambient
; routines: if the freeze mask is set (paused / fuzzy mosaic / item active),
; pop the caller's return address and bail so physics doesn't tick.
; Raidenthequick: CODE_check_ambient_sprite_freeze / CODE_check_amb_sprite_freeze_no_pull.
;
; INPUTS:   $0B8F (freeze mask); X = slot index; per-slot timers at
;           $7782,x (lifetime), $7E8E,x (animation), $7781,x.
; OUTPUTS:  on freeze: skip caller (pull variant) or just return (no-pull);
;           on slot-expire (lifetime == 0): clears SpriteExistsFlag, frees
;           OAM slot at $7462,x, releases coupled OAM at $7ECE/$7ECC.
;           Otherwise decrements lifetime/animation/$7781 timers.
; MODIFIES: A, Y; SpriteExistsFlag, $7462, $7782, $7E8E, $7781, $76E2,
;           $7ECC.
; CALLERS:  most ambient_* routines in this bank (~60 callers).
;-------------------------------------------------------------------------
CODE_008AE5:
CODE_check_ambient_sprite_freeze:                  ; Raidenthequick: CODE_check_ambient_sprite_freeze
	LDA.w $0B8F
	BEQ.b CODE_008AF2
	PLA                                       ; discard caller -- skip frame
	RTS

CODE_008AEC:
CODE_check_amb_sprite_freeze_no_pull:              ; Raidenthequick: CODE_check_amb_sprite_freeze_no_pull
	LDA.w $0B8F
	BEQ.b CODE_008AF2
	RTS

CODE_008AF2:
	LDA.w $7782,x
	BNE.b CODE_008B0D
	PLA
CODE_008AF8:
	STZ.w !EXRAM_YI_Level_AmbSpr_SpriteExistsFlag|!EXRAMBankMirror,x
	LDA.w #$00FF
	STA.w $7462,x
	LDY.w $76E2,x
	BMI.b CODE_008B0C
	LDA.w $7ECE,y
	TRB.w $7ECC
CODE_008B0C:
	RTS

CODE_008B0D:
	DEC.w $7782,x
	LDA.w $7E8E,x
	BEQ.b CODE_008B18
	DEC.w $7E8E,x
CODE_008B18:
	LDY.w $7781,x
	BEQ.b CODE_008B20
	DEC.w $7781,x
CODE_008B20:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_spawn_ambient_sprite -- allocate an ambient-sprite slot, seed it from the
; caller-pushed sprite ID, and zero its physics state.
; Raidenthequick: CODE_spawn_ambient_sprite.
; Linear scan from slot $3C downward looking for an empty slot; if all 16
; slots are live, rotates through them using $7E4A as a round-robin cursor.
;
; INPUTS:   A = ambient sprite ID; X = caller's slot ID (preserved); slots
;           at !EXRAM_YI_Level_AmbSpr_SpriteExistsFlag stride 4.
; OUTPUTS:  Y = allocated slot index; all per-slot fields zeroed;
;           SpriteID stored; FXDATA_0AB?12 lookup populates default OAM
;           tile / palette / size / X-Y-offset / collision-shape fields.
; MODIFIES: A, X, Y; 60 ExRAM slots at the chosen Y; M-width restored on exit.
; CALLERS:  whenever a visual-only sprite spawns -- coin collection, splash
;           on water entry, smoke puffs after enemy stomp, score popups.
;-------------------------------------------------------------------------
CODE_008B21:
CODE_spawn_ambient_sprite:                         ; Raidenthequick: CODE_spawn_ambient_sprite
	PHA                                       ; preserve A (sprite ID)
	LDY.b #$3C                                ; start at highest slot
CODE_008B24:
	LDA.w !EXRAM_YI_Level_AmbSpr_SpriteExistsFlag|!EXRAMBankMirror,y
	BEQ.b CODE_008B3D                         ; -> found empty slot
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_008B24
	LDY.w $7E4A
	DEY
	DEY
	DEY
	DEY
	BPL.b CODE_008B3A
	LDY.b #$3C
CODE_008B3A:
	STY.w $7E4A
CODE_008B3D:
	LDA.w #$0000
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	STA.w $73C0,y
	STA.w $70A0,y
	STA.w $7140,y
	STA.w $7E4C,y
	STA.w $7E4E,y
	STA.w $7E8C,y
	STA.w $7782,y
	STA.w $7E8E,y
	STA.w $73C2,y
	STA.w $7820,y
	STA.w !EXRAM_YI_Level_AmbSpr_UnusedRAM1|!EXRAMBankMirror,y
	STA.w $76E0,y
	STA.w $7640,y
	STA.w $7642,y
	STA.w $7500,y
	STA.w $75A0,y
	STA.w $7780,y
	DEC
	STA.w !EXRAM_YI_Level_AmbSpr_OAMIndex|!EXRAMBankMirror,y
	STA.w $76E2,y
	LDA.w #$1FFF
	STA.w $7822,y
	PLA
	STA.w !EXRAM_YI_Level_AmbSpr_SpriteID|!EXRAMBankMirror,y
	PHX
	ASL
	REP.b #$10
	TAX
	SEP.b #$20
	PHY
	LDA.l FXDATA_0AB912-(!Define_YI_AmbSpr1BA*$02),x
	LDY.w #$0006
CODE_008B99:
	CMP.w $6EB5,y
	BEQ.b CODE_008BA4
	DEY
	BNE.b CODE_008B99
	TYA
	BRA.b CODE_008BA9

CODE_008BA4:
	TYA
	ADC.b #$06
	ASL
	ASL
CODE_008BA9:
	REP.b #$20
	AND.w #$00FF
	PLY
	STA.w $7140,y
	LDA.l FXDATA_0AB512-(!Define_YI_AmbSpr1BA*$02)+$01,x
	AND.w #$00FF
	EOR.w #$0030
	STA.w $7002,y
	LDA.l FXDATA_0AB512-(!Define_YI_AmbSpr1BA*$02),x
	AND.w #$00FF
	STA.w $7462,y
	LDA.l FXDATA_0AB712-(!Define_YI_AmbSpr1BA*$02)-$01,x
	AND.w #$FF00
	BPL.b CODE_008BD5
	ORA.w #$00FF
CODE_008BD5:
	XBA
	STA.w $7502,y
	LDA.l FXDATA_0AB712-(!Define_YI_AmbSpr1BA*$02),x
	AND.w #$FF00
	BPL.b CODE_008BE5
	ORA.w #$00FF
CODE_008BE5:
	XBA
	ASL
	ASL
	ASL
	ASL
	STA.w $75A2,y
	LDA.l FXDATA_0AAF12-(!Define_YI_AmbSpr1BA*$02),x
	STA.w $6F60,y
	LDA.l FXDATA_0AB112-(!Define_YI_AmbSpr1BA*$02),x
	STA.w $6F62,y
	LDA.l FXDATA_0AB312-(!Define_YI_AmbSpr1BA*$02),x
	STA.w $7000,y
	LDA.w #$000E
	STA.w !EXRAM_YI_Level_AmbSpr_SpriteExistsFlag|!EXRAMBankMirror,y
	LDA.w #$00FF
	STA.w $7460,y
	SEP.b #$10
	PLX
	RTL

;---------------------------------------------------------------------------

CODE_008C12:
CODE_ambient_apply_physics:                        ; shared ambient-sprite integrator: applies $7500/7502 acceleration to XSpeed/YSpeed, propagates to $70A0/7140 position with overflow into $7280/7282 / $70A2/7142 subpixel accumulators
	LDA.w $75A0,x
	SEC
	SBC.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,x
	ASL
	LDA.w $7500,x
	BCC.b CODE_008C23
	EOR.w #$FFFF
	INC
CODE_008C23:
	CLC
	ADC.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,x
	AND.w #$00FF
	XBA
	CLC
	ADC.w $70A0,x
	STA.w $70A0,x
	LDA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,x
	AND.w #$FF00
	BPL.b CODE_008C40
	ORA.w #$00FF
CODE_008C40:
	XBA
	ADC.w #$0000
	STA.w $7280,x
	CLC
	ADC.w $70A2,x
	STA.w $70A2,x
	LDA.w $75A2,x
	SEC
	SBC.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
	ASL
	LDA.w $7502,x
	BCC.b CODE_008C5F
	EOR.w #$FFFF
	INC
CODE_008C5F:
	CLC
	ADC.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
	AND.w #$00FF
	XBA
	CLC
	ADC.w $7140,x
	STA.w $7140,x
	LDA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
	AND.w #$FF00
	BPL.b CODE_008C7C
	ORA.w #$00FF
CODE_008C7C:
	XBA
	ADC.w #$0000
	STA.w $7282,x
	CLC
	ADC.w $7142,x
	STA.w $7142,x
	RTS

;---------------------------------------------------------------------------

DATA_008C8B:
	dw $0007,$0008,$0009,$000A,$0009,$0008,$0007,$0006
	dw $0005,$0004,$0003,$0002,$0001

DATA_008CA5:
	dw $0003,$0004,$0005,$0004,$0003,$0003,$0003,$0003
	dw $0003,$0003,$0003,$0003,$0003

CODE_008CBF:
CODE_ambient_water_splash_transition:              ; Raidenthequick: CODE_ambient_water_splash_transition
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_008CDF
	LDA.w $7E4C,x
	DEC
	DEC
	BPL.b CODE_008CCF
	RTS

CODE_008CCF:
	STA.w $7E4C,x
	TAY
	LDA.w DATA_008C8B,y
	STA.w $73C2,x
	LDA.w DATA_008CA5,y
	STA.w $7782,x
CODE_008CDF:
	RTS

;---------------------------------------------------------------------------

DATA_008CE0:
	dw $0000,$0002,$0001,$0001,$0000,$0000,$0001,$0000
	dw $0000,$0000,$0000,$FFFF,$0000,$0000,$FFFF,$FFFF
	dw $FFFE,$0000

CODE_008D04:
CODE_ambient_water_splash_swimming:                ; Raidenthequick: CODE_ambient_water_splash_swimming
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	ASL
	TAY
	LDA.w DATA_008CE0-$02,y
	CLC
	ADC.w $7142,x
	STA.w $7142,x
	RTS

;---------------------------------------------------------------------------

DATA_008D17:
	dw $0001,$0000,$0000,$0000,$0000,$0000,$FFFF,$0000
	dw $FFFF,$0000,$0000,$0000,$0000,$0000,$0001,$0000

CODE_008D37:
CODE_ambient_bubble_in_water:                      ; Raidenthequick: CODE_ambient_bubble_in_water
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7822,x
	AND.w #$00FF
	STA.w $7782,x
	BNE.b CODE_008D48
	JMP.w CODE_008AF8

CODE_008D48:
	LDA.w #$00FF
	ORA.w $7822,x
	STA.w $7822,x
	LDA.w #$0002
	STA.w $7462,x
	INC.w $7E4C,x
	LDA.w $7E4C,x
	BIT.w #$0018
	BEQ.b CODE_008D65
	DEC.w $7142,x
CODE_008D65:
	AND.w #$000F
	ASL
	TAY
	LDA.w $70A2,x
	CLC
	ADC.w DATA_008D17,y
	STA.w $70A2,x
	RTS

;---------------------------------------------------------------------------

CODE_008D75:
CODE_ambient_eggshell:                             ; Raidenthequick: CODE_ambient_eggshell
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_008D89
	INC.w $7782,x
	LDA.w $7002,x
	ORA.w #$0080
	STA.w $7002,x
CODE_008D89:
	RTS

;---------------------------------------------------------------------------

DATA_008D8A:
	db $40,$40,$FF,$00,$00

;---------------------------------------------------------------------------

CODE_008D8F:
CODE_ambient_small_bopping_ani:                    ; Raidenthequick: CODE_ambient_small_bopping_ani
	JSR.w CODE_check_ambient_sprite_freeze
	INC.w $73C2,x
	RTS

;---------------------------------------------------------------------------

CODE_008D96:
CODE_ambient_coin_get:                             ; Raidenthequick: CODE_ambient_coin_get
	JSR.w CODE_check_amb_sprite_freeze_no_pull
	LDA.b $14
	LSR
	LSR
	LSR
	AND.w #$0003
	STA.w $73C2,x
	RTS

;---------------------------------------------------------------------------

CODE_008DA5:
CODE_ambient_score_sprites:                        ; Raidenthequick: CODE_ambient_score_sprites
	JSR.w CODE_check_amb_sprite_freeze_no_pull
	RTS

;---------------------------------------------------------------------------

DATA_008DA9:
	db $02,$01,$00,$FF,$00

DATA_008DAE:
	db $06,$06,$06,$03

CODE_008DB2:
	JSR.w CODE_check_ambient_sprite_freeze
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w $7782,x
	BNE.b CODE_008DD7
	DEC.w $7E4C,x
	BMI.b CODE_008DE4
	DEY
	CPY.b #$03
	BNE.b CODE_008DD1
	LDA.w $7000,x
	AND.b #$FC
	STA.w $7000,x
CODE_008DD1:
	LDA.w DATA_008DAE,y
	STA.w $7782,x
CODE_008DD7:
	LDA.w DATA_008DA9,y
	STA.w $73C2,x
	BMI.b CODE_008DE1
	LDA.b #$06
CODE_008DE1:
	STA.w $7462,x
CODE_008DE4:
	REP.b #$20
	RTS

;---------------------------------------------------------------------------

CODE_008DE7:
	JSR.w CODE_check_ambient_sprite_freeze
	SEP.b #$20
	LDA.w $7782,x
	LSR
	LSR
	LSR
	STA.w $73C2,x
	REP.b #$20
	RTS

;---------------------------------------------------------------------------

CODE_008DF8:
	DEC.w $7782,x
	LDA.w $7782,x
	BNE.b CODE_008E03
	JMP.w CODE_008AF8

CODE_008E03:
	CMP.w #$003F
	BCS.b CODE_008E0B
	DEC.w $7782,x
CODE_008E0B:
	SEP.b #$20
	LSR
	AND.b #$07
	STA.w $73C2,x
	REP.b #$20
	RTS

;---------------------------------------------------------------------------

CODE_008E16:
	JSR.w CODE_check_ambient_sprite_freeze
	LDY.w $73C2,x
	LDA.w $7782,x
	BNE.b CODE_008E2F
	DEC.w $73C2,x
	BPL.b CODE_008E29
	JMP.w CODE_008AF8

CODE_008E29:
	LDA.w #$0002
	STA.w $7782,x
CODE_008E2F:
	RTS

;---------------------------------------------------------------------------

DATA_008E30:
	db $09,$07,$06,$03

DATA_008E34:
	db $02,$01,$00

CODE_008E37:
	JSR.w CODE_check_ambient_sprite_freeze
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w $7782,x
	BNE.b CODE_008E4F
	DEC.w $7E4C,x
	BMI.b CODE_008E55
	LDA.w DATA_008E30-$01,y
	STA.w $7782,x
CODE_008E4F:
	LDA.w DATA_008E34-$01,y
	STA.w $73C2,x
CODE_008E55:
	REP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_008E58:
	db $06,$06,$06,$06,$04,$03

CODE_008E5E:
	JSR.w CODE_check_ambient_sprite_freeze
	SEP.b #$20
	LDY.w $73C2,x
	LDA.w $7782,x
	BNE.b CODE_008E77
	DEY
	BMI.b CODE_008E77
	DEC.w $73C2,x
	LDA.w DATA_008E58,y
	STA.w $7782,x
CODE_008E77:
	REP.b #$20
	RTS

;---------------------------------------------------------------------------

DATA_008E7A:
	db $06,$06,$05,$05

CODE_008E7E:
	JSR.w CODE_check_ambient_sprite_freeze
	SEP.b #$20
	LDY.w $73C2,x
	LDA.w $7782,x
	LSR
	BNE.b CODE_008E9A
	DEY
	DEY
	BMI.b CODE_008E9A
	TYA
	STA.w $73C2,x
	LDA.w DATA_008E7A,y
	STA.w $7782,x
CODE_008E9A:
	REP.b #$10
	LDA.w $73C2,x
	LSR
	TXY
	LDX.w $7E4C,y
	LDA.l DATA_cosine_lut_8bit_radians,x
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.l DATA_cosine_lut_8bit_radians+$01,x
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.b #$FC
	BCC.b CODE_008EB8
	LDA.b #$FE
CODE_008EB8:
	CLC
	ADC.w $7E4E,y
	STA.w $7E4E,y
	STA.w !REGISTER_Mode7MatrixParameterB
	REP.b #$20
	LDA.w !REGISTER_PPUMultiplicationProductMid
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,y
	LDA.l DATA_sine_lut_8bit_radians,x
	SEP.b #$20
	STA.w !REGISTER_Mode7MatrixParameterA
	XBA
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.w $7E4E,y
	STA.w !REGISTER_Mode7MatrixParameterB
	REP.b #$20
	LDA.w !REGISTER_PPUMultiplicationProductMid
	ASL
	ASL
	ASL
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,y
	SEP.b #$10
	TYX
	RTS

;---------------------------------------------------------------------------

CODE_008EEF:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_008EFD
	LDA.w #$0001
	STA.w $73C2,x
CODE_008EFD:
	RTS

;---------------------------------------------------------------------------

CODE_008EFE:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	LSR
	LSR
	LSR
	STA.w $73C2,x
	RTS

;---------------------------------------------------------------------------

CODE_008F0B:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	CMP.w #$0008
	BNE.b CODE_008F19
	INC.w $73C2,x
CODE_008F19:
	AND.w #$0007
	BNE.b CODE_008F2E
	LDA.w !EXRAM_YI_Global_RNGOutputLo|!EXRAMBankMirror
	AND.w #$0001
	BNE.b CODE_008F27
	DEC
CODE_008F27:
	CLC
	ADC.w $70A2,x
	STA.w $70A2,x
CODE_008F2E:
	RTS

;---------------------------------------------------------------------------

DATA_008F2F:
	db $02,$02,$02,$01,$01,$01

DATA_008F35:
	db $03,$03,$03,$02,$02,$02

CODE_008F3B:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_008F5B
	SEP.b #$20
	DEC.w $7E4C,x
	BEQ.b CODE_008F59
	LDY.w $7E4C,x
	LDA.w DATA_008F35-$01,y
	STA.w $7782,x
	LDA.w DATA_008F2F-$01,y
	STA.w $73C2,x
CODE_008F59:
	REP.b #$20
CODE_008F5B:
	RTS

;---------------------------------------------------------------------------

DATA_008F5C:
	db $05,$04,$03,$01,$01,$02,$01

DATA_008F63:
	db $03,$03,$03,$03,$03,$04,$04

CODE_008F6A:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_008F8A
	DEC.w $7E4C,x
	BMI.b CODE_008F8A
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_008F5C,y
	STA.w $73C2,x
	LDA.w DATA_008F63,y
	STA.w $7782,x
	REP.b #$20
CODE_008F8A:
	RTS

;---------------------------------------------------------------------------

DATA_008F8B:
	db $08,$07,$06,$05,$04,$03,$02,$01

DATA_008F93:
	db $40,$02,$02,$02,$02,$02,$02,$02

CODE_008F9B:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_008FBB
	DEC.w $7E4C,x
	BMI.b CODE_008FBB
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_008F8B,y
	STA.w $73C2,x
	LDA.w DATA_008F93,y
	STA.w $7782,x
	REP.b #$20
CODE_008FBB:
	RTS

;---------------------------------------------------------------------------

DATA_008FBC:
	db $0B,$0A,$09,$08,$07,$06,$05,$04
	db $03,$02,$01

DATA_008FC7:
	db $04,$04,$04,$04,$04,$04,$03,$03
	db $02,$02,$01

CODE_008FD2:
	LDY.w $7E4E,x
	BEQ.b CODE_008FE4
	LDA.w $0B8F
	BEQ.b CODE_008FE4
	DEC.w $7782,x
	BPL.b CODE_008FE7
	JMP.w CODE_008AF8

CODE_008FE4:
	JSR.w CODE_check_ambient_sprite_freeze
CODE_008FE7:
	LDA.w $7782,x
	BNE.b CODE_009004
	DEC.w $7E4C,x
	BMI.b CODE_009004
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_008FBC,y
	STA.w $73C2,x
	LDA.w DATA_008FC7,y
	STA.w $7782,x
	REP.b #$20
CODE_009004:
	RTS

;---------------------------------------------------------------------------

DATA_009005:
	db $01

DATA_009006:
	db $11

CODE_009007:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009027
	DEC.w $7E4C,x
	BMI.b CODE_009027
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_009005,y
	STA.w $73C2,x
	LDA.w DATA_009006,y
	STA.w $7782,x
	REP.b #$20
CODE_009027:
	RTS

;---------------------------------------------------------------------------

CODE_009028:
	JSR.w CODE_check_ambient_sprite_freeze
	LDY.w $7E4C,x
	LDA.w $70E2,y
	STA.b $00
	LDA.w $7182,y
	CLC
	ADC.w #$0008
	STA.b $02
	LDA.w $7E4E,x
	STA.b $06
	LDA.w $7E8C,x
	STA.b $04
	LDA.w $70A2,x
	STA.b $08
	LDA.w $7142,x
	STA.b $0A
	JSL.l CODE_049B42
	LDA.b $04
	STA.w $7E8C,x
	BPL.b CODE_009061
	EOR.w #$FFFF
	INC
	STA.b $04
CODE_009061:
	LDA.b $06
	STA.w $7E4E,x
	BPL.b CODE_00906C
	EOR.w #$FFFF
	INC
CODE_00906C:
	CLC
	ADC.b $04
	CMP.w #$0030
	BCS.b CODE_00907A
	LDA.w #$0001
	STA.w $73C2,x
CODE_00907A:
	LDA.b $08
	STA.w $70A2,x
	LDA.b $0A
	STA.w $7142,x
	RTS

;---------------------------------------------------------------------------

DATA_009085:
	db $0A,$09,$08,$07,$06,$05,$04,$03
	db $02,$01

DATA_00908F:
	db $05,$05,$05,$04,$04,$04,$03,$03
	db $02,$02

CODE_009099:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_0090B9
	DEC.w $7E4C,x
	BMI.b CODE_0090B9
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_009085,y
	STA.w $73C2,x
	LDA.w DATA_00908F,y
	STA.w $7782,x
	REP.b #$20
CODE_0090B9:
	RTS

;---------------------------------------------------------------------------

CODE_0090BA:
	JSR.w CODE_check_amb_sprite_freeze_no_pull
	RTS

;---------------------------------------------------------------------------

DATA_0090BE:
	db $06,$04,$04,$03,$03

CODE_0090C3:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_0090DF
	DEC.w $73C2,x
	BPL.b CODE_0090D3
	JMP.w CODE_008AF8

CODE_0090D3:
	LDY.w $73C2,x
	LDA.w DATA_0090BE,y
	AND.w #$00FF
	STA.w $7782,x
CODE_0090DF:
	RTS

;---------------------------------------------------------------------------

DATA_0090E0:
	db $0B,$0A,$09,$08,$07,$06,$05,$04
	db $03,$02,$01

DATA_0090EB:
	db $06,$06,$06,$06,$06,$06,$06
	db $03,$03,$03,$03

CODE_0090F6:
	LDY.w $7E4E,x
	BEQ.b CODE_009100
	JSR.w CODE_008AF2
	BRA.b CODE_009103

CODE_009100:
	JSR.w CODE_check_ambient_sprite_freeze
CODE_009103:
	LDA.w $7782,x
	BNE.b CODE_009120
	DEC.w $7E4C,x
	BMI.b CODE_009120
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_0090E0,y
	STA.w $73C2,x
	LDA.w DATA_0090EB,y
	STA.w $7782,x
	REP.b #$20
CODE_009120:
	RTS

;---------------------------------------------------------------------------

DATA_009121:
	db $06,$05,$04,$03,$02,$01

DATA_009127:
	db $04,$08,$08,$08,$04,$02

CODE_00912D:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00914D
	DEC.w $7E4C,x
	BMI.b CODE_00914D
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_009121,y
	STA.w $73C2,x
	LDA.w DATA_009127,y
	STA.w $7782,x
	REP.b #$20
CODE_00914D:
	RTS

;---------------------------------------------------------------------------

DATA_00914E:
	db $03,$02,$01

DATA_009151:
	db $06,$04,$02

CODE_009154:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009174
	DEC.w $7E4C,x
	BMI.b CODE_009174
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_00914E,y
	STA.w $73C2,x
	LDA.w DATA_009151,y
	STA.w $7782,x
	REP.b #$20
CODE_009174:
	RTS

;---------------------------------------------------------------------------

DATA_009175:
	db $03,$02,$01

DATA_009178:
	db $06,$04,$02

CODE_00917B:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00919B
	DEC.w $7E4C,x
	BMI.b CODE_00919B
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_009175,y
	STA.w $73C2,x
	LDA.w DATA_009178,y
	STA.w $7782,x
	REP.b #$20
CODE_00919B:
	RTS

;---------------------------------------------------------------------------

DATA_00919C:
	db $02,$01

DATA_00919E:
	db $0C,$08

CODE_0091A0:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_0091C0
	DEC.w $7E4C,x
	BMI.b CODE_0091C0
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_00919C,y
	STA.w $73C2,x
	LDA.w DATA_00919E,y
	STA.w $7782,x
	REP.b #$20
CODE_0091C0:
	RTS

;---------------------------------------------------------------------------

DATA_0091C1:
	db $03,$02,$01

DATA_0091C4:
	db $08,$08,$04

CODE_0091C7:
	JSR.w CODE_ambient_apply_physics
	LDA.w $75A0,x
	CMP.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0091D9
	EOR.w #$FFFF
	INC
	STA.w $75A0,x
CODE_0091D9:
	LDA.w $75A2,x
	CMP.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
	BNE.b CODE_0091E8
	EOR.w #$FFFF
	INC
	STA.w $75A2,x
CODE_0091E8:
	DEC.w $7782,x
	BNE.b CODE_009213
	DEC.w $7E4C,x
	BPL.b CODE_0091F6
	JSR.w CODE_008AF8
	RTS

CODE_0091F6:
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_0091C1,y
	STA.w $73C2,x
	LDA.w DATA_0091C4,y
	STA.w $7782,x
	REP.b #$20
	CPY.b #$02
	BMI.b CODE_009213
	LDA.w #$0080
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_009213:
	RTS

;---------------------------------------------------------------------------

DATA_009214:
	db $03,$02,$01

DATA_009217:
	db $08,$08,$08

CODE_00921A:
	JSR.w CODE_ambient_apply_physics
	JSR.w CODE_008AF2
	LDA.w $7782,x
	BNE.b CODE_00923D
	DEC.w $7E4C,x
	BMI.b CODE_00923D
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_009214,y
	STA.w $73C2,x
	LDA.w DATA_009217,y
	STA.w $7782,x
	REP.b #$20
CODE_00923D:
	RTS

;---------------------------------------------------------------------------

DATA_00923E:
	db $0B,$0A,$09,$08,$07,$06,$05,$04
	db $03,$02,$01

DATA_009249:
	db $01,$01,$01,$01,$01,$01,$01,$01
	db $01,$01,$02

CODE_009254:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009274
	DEC.w $7E4C,x
	BMI.b CODE_009274
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_00923E,y
	STA.w $73C2,x
	LDA.w DATA_009249,y
	STA.w $7782,x
	REP.b #$20
CODE_009274:
	RTS

;---------------------------------------------------------------------------

DATA_009275:
	db $04,$03,$02,$01

DATA_009279:
	db $06,$06,$06,$06

CODE_00927D:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00929D
	DEC.w $7E4C,x
	BMI.b CODE_00929D
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_009275,y
	STA.w $73C2,x
	LDA.w DATA_009279,y
	STA.w $7782,x
	REP.b #$20
CODE_00929D:
	RTS

;---------------------------------------------------------------------------

DATA_00929E:
	db $03,$03,$03,$03,$03,$03,$03

; Stomp-puff with physics: ambient main for $1E7 stomp-puff variant.
; Applies ambient physics first (when $0B8F != 0), then falls through
; into the standard stomp-puff body.
CODE_0092A5:
CODE_ambient_main_stomp_puff_physics_variant:
	LDA.w $0B8F
	BEQ.b CODE_ambient_main_stomp_puff
	JSR.w CODE_ambient_apply_physics
; Stomp-puff main body: ambient main for $1E6 (universal enemy-stomp
; impact puff). 7-frame tile walk via $7E4C->$73C2 (TYA pattern;
; tile-index == stage value directly), hold from DATA_00929E (uniform 3).
CODE_0092AD:
CODE_ambient_main_stomp_puff:
	JSR.w CODE_008AF2
	LDA.w $7782,x
	BNE.b CODE_0092CB
	DEC.w $7E4C,x
	BMI.b CODE_0092CB
	SEP.b #$20
	LDY.w $7E4C,x
	TYA
	STA.w $73C2,x
	LDA.w DATA_00929E,y
	STA.w $7782,x
	REP.b #$20
CODE_0092CB:
	RTS

;---------------------------------------------------------------------------

DATA_0092CC:
	db $03,$02,$00,$01

DATA_0092D0:
	dw $0008,$FFFA,$FFFD,$0001,$0009

DATA_0092DA:
	dw $FFF8,$0006,$0003,$FFFF,$FFF7

DATA_0092E4:
	dw $FFFE,$0004,$FFFE,$FFFC,$FFFB

CODE_0092EE:
	LDY.w $7E4E,x
	LDA.w $7400,y
	STA.b $00
	LDA.w $7402,y
	SEC
	SBC.w #$001B
	ASL
	PHY
	TAY
	LDA.b $00
	BEQ.b CODE_009309
	LDA.w DATA_0092DA,y
	BRA.b CODE_00930C

CODE_009309:
	LDA.w DATA_0092D0,y
CODE_00930C:
	STA.b $00
	LDA.w DATA_0092E4,y
	STA.b $02
	PLY
	LDA.w $70E2,y
	CLC
	ADC.b $00
	CLC
	ADC.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C0|!EXRAMBankMirror,x
	CMP.w $70A2,x
	BEQ.b CODE_00932D
	BMI.b CODE_00932A
	INC.w $70A2,x
	BRA.b CODE_00932D

CODE_00932A:
	DEC.w $70A2,x
CODE_00932D:
	LDA.w $7182,y
	CLC
	ADC.b $02
	CLC
	ADC.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C2|!EXRAMBankMirror,x
	CMP.w $7142,x
	BEQ.b CODE_009346
	BMI.b CODE_009343
	INC.w $7142,x
	BRA.b CODE_009346

CODE_009343:
	DEC.w $7142,x
CODE_009346:
	DEC.w $7782,x
	BNE.b CODE_009370
	DEC.w $7E4C,x
	BPL.b CODE_009354
	JSR.w CODE_008AF8
	RTS

CODE_009354:
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_0092CC,y
	STA.w $73C2,x
	LDA.b #$04
	STA.w $7782,x
	REP.b #$20
	CPY.b #$02
	BMI.b CODE_009370
	LDA.w #$0080
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_009370:
	RTS

;---------------------------------------------------------------------------

DATA_009371:
	db $03,$02,$01,$00,$04

CODE_009376:
	LDY.w $7E4E,x
	BEQ.b CODE_009380
	JSR.w CODE_008AF2
	BRA.b CODE_009383

CODE_009380:
	JSR.w CODE_check_ambient_sprite_freeze
CODE_009383:
	LDA.w $7782,x
	BNE.b CODE_00939F
	DEC.w $7E4C,x
	BMI.b CODE_00939F
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_009371,y
	STA.w $73C2,x
	LDA.b #$04
	STA.w $7782,x
	REP.b #$20
CODE_00939F:
	RTS

;---------------------------------------------------------------------------

DATA_0093A0:
	db $04,$03,$02,$01

CODE_0093A4:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_0093C3
	DEC.w $7E4C,x
	BMI.b CODE_0093C3
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_0093A0,y
	STA.w $73C2,x
	LDA.b #$04
	STA.w $7782,x
	REP.b #$20
CODE_0093C3:
	RTS

;---------------------------------------------------------------------------

DATA_0093C4:
	db $09,$08,$07,$06,$05,$04,$03,$02
	db $01,$00,$FF,$00,$FF

DATA_0093D1:
	db $03,$03,$03,$03,$03,$02,$02,$02
	db $01,$03,$01,$01,$01

CODE_0093DE:
	JSR.w CODE_008AF2
	LDA.w $7782,x
	BNE.b CODE_00940F
	DEC.w $7E4C,x
	BMI.b CODE_00940F
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_0093C4,y
	BPL.b CODE_0093FF
	LDA.w $7E4E,x
	BPL.b CODE_0093FF
	STA.w $7462,x
	BRA.b CODE_009407

CODE_0093FF:
	STA.w $73C2,x
	LDA.b #$02
	STA.w $7462,x
CODE_009407:
	LDA.w DATA_0093D1,y
	STA.w $7782,x
	REP.b #$20
CODE_00940F:
	RTS

;---------------------------------------------------------------------------

DATA_009410:
	db $02,$04,$06,$0A,$06,$04

CODE_009416:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009432
	DEC.w $73C2,x
	BPL.b CODE_009426
	JMP.w CODE_008AF8

CODE_009426:
	LDY.w $73C2,x
	LDA.w DATA_009410,y
	AND.w #$00FF
	STA.w $7782,x
CODE_009432:
	RTS

;---------------------------------------------------------------------------

CODE_009433:
	LDA.w !EXRAM_YI_Level_AmbSpr_OAMIndex|!EXRAMBankMirror,x
	BPL.b CODE_009446
	LDA.w $61CE
	BEQ.b CODE_009443
	LDA.w #$0006
	STA.w $7462,x
CODE_009443:
	JMP.w CODE_009503

CODE_009446:
	LDA.w $61CE
	BEQ.b CODE_009474
	LDA.w $70A2,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7142,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $7E8C,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w !EXRAM_YI_Level_AmbSpr_OAMIndex|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w #$0004
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	PHX
	LDX.b #FXCODE_09F5F4>>16
	LDA.w #FXCODE_09F5F4
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
CODE_009474:
	REP.b #$10
	TAY
	LDA.w $7E4E,x
	BNE.b CODE_009485
	LDA.w #$0010
	SEC
	SBC.w $7E4C,x
	BPL.b CODE_009488
CODE_009485:
	LDA.w #$0000
CODE_009488:
	STA.b $00
	LDA.w $6000,y
	SEC
	SBC.b $00
	STA.w $6000,y
	LDA.w $6002,y
	SEC
	SBC.b $00
	STA.w $6002,y
	LDA.w $6008,y
	CLC
	ADC.b $00
	STA.w $6008,y
	LDA.w $600A,y
	SEC
	SBC.b $00
	STA.w $600A,y
	LDA.w $6010,y
	SEC
	SBC.b $00
	STA.w $6010,y
	LDA.w $6012,y
	CLC
	ADC.b $00
	STA.w $6012,y
	LDA.w $6018,y
	CLC
	ADC.b $00
	STA.w $6018,y
	LDA.w $601A,y
	CLC
	ADC.b $00
	STA.w $601A,y
	BRA.b CODE_009501

CODE_0094D4:
	LDA.w #$0020
	SEC
	SBC.w $7E4C,x
	STA.b $00
	LDA.w $6002,y
	CLC
	ADC.b $00
	STA.w $6002,y
	LDA.w $6008,y
	SEC
	SBC.b $00
	STA.w $6008,y
	LDA.w $6010,y
	CLC
	ADC.b $00
	STA.w $6010,y
	LDA.w $601A,y
	SEC
	SBC.b $00
	STA.w $601A,y
CODE_009501:
	SEP.b #$10
CODE_009503:
	JSR.w CODE_008AF2
	LDA.w $7E4C,x
	CLC
	ADC.w #$0004
	CMP.w #$0020
	BCC.b CODE_009515
	LDA.w #$0020
CODE_009515:
	STA.w $7E4C,x
	RTS

;---------------------------------------------------------------------------

; Freeze-only stub: just runs the freeze-check helper and returns. No
; $73C2 work, no lifetime decrement; the slot's lifetime is driven
; entirely by $7782 ticking elsewhere. Used as a placeholder ambient
; body for slots whose only per-frame logic is "stay frozen during
; the level pause" -- the spawner sets the lifetime fields directly.
CODE_009519:
CODE_ambient_freeze_only_stub:
	JSR.w CODE_check_amb_sprite_freeze_no_pull
	RTS

;---------------------------------------------------------------------------

; Tile-decrement stride 1: per-frame, when $7782 hits 0, dec $73C2 and
; despawn on underflow. The "stride" controls how many frames each tile
; lingers; this one uses INC $7782 rather than the LDA #imm/STA $7782
; pattern of the stride-2..8 variants, making it cycle on every other
; frame (1-frame visible, 1-frame skipped per tile).
CODE_00951D:
CODE_ambient_tile_dec_stride_1:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00952D
	INC.w $7782,x
	DEC.w $73C2,x
	BMI.b CODE_00952E
CODE_00952D:
	RTS

CODE_00952E:
	JMP.w CODE_008AF8

;---------------------------------------------------------------------------

; Tile-decrement stride 2: each visible OAM tile holds for 2 frames.
CODE_009531:
CODE_ambient_tile_dec_stride_2:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009544
	LDA.w #$0002
	STA.w $7782,x
	DEC.w $73C2,x
	BMI.b CODE_009545
CODE_009544:
	RTS

CODE_009545:
	JMP.w CODE_008AF8

;---------------------------------------------------------------------------

; Tile-decrement stride 3: each visible OAM tile holds for 3 frames.
CODE_009548:
CODE_ambient_tile_dec_stride_3:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00955B
	LDA.w #$0003
	STA.w $7782,x
	DEC.w $73C2,x
	BMI.b CODE_00955C
CODE_00955B:
	RTS

CODE_00955C:
	JMP.w CODE_008AF8

;---------------------------------------------------------------------------

; Tile-decrement stride 4: each visible OAM tile holds for 4 frames.
CODE_00955F:
CODE_ambient_tile_dec_stride_4:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009572
	LDA.w #$0004
	STA.w $7782,x
	DEC.w $73C2,x
	BMI.b CODE_009573
CODE_009572:
	RTS

CODE_009573:
	JMP.w CODE_008AF8

;---------------------------------------------------------------------------

; Tile-decrement stride 6: each visible OAM tile holds for 6 frames.
CODE_009576:
CODE_ambient_tile_dec_stride_6:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009589
	LDA.w #$0006
	STA.w $7782,x
	DEC.w $73C2,x
	BMI.b CODE_00958A
CODE_009589:
	RTS

CODE_00958A:
	JMP.w CODE_008AF8

;---------------------------------------------------------------------------

; Tile-decrement stride 8: each visible OAM tile holds for 8 frames.
CODE_00958D:
CODE_ambient_tile_dec_stride_8:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_0095A0
	LDA.w #$0008
	STA.w $7782,x
	DEC.w $73C2,x
	BMI.b CODE_0095A1
CODE_0095A0:
	RTS

CODE_0095A1:
	JMP.w CODE_008AF8

;---------------------------------------------------------------------------

DATA_0095A4:
	dw $0020,$0022,$8020,$4002,$0000,$0002,$0020,$0022
	dw $8020,$8002

DATA_0095B8:
	dw $0000,$0000,$8000,$4000,$0000,$0000,$0000,$0000
	dw $8000,$8000

CODE_0095CC:
	LDA.w !EXRAM_YI_Level_AmbSpr_OAMIndex|!EXRAMBankMirror,x
	BMI.b CODE_0095F3
	LDY.w $7E4E,x
	LDA.w DATA_0095A4,y
	STA.b $00
	LDA.w DATA_0095B8,y
	STA.b $02
	REP.b #$10
	LDY.w !EXRAM_YI_Level_AmbSpr_OAMIndex|!EXRAMBankMirror,x
	LDA.w $6004,y
	ORA.b $00
	EOR.b $02
	CLC
	ADC.w $7E8C,x
	STA.w $6004,y
	SEP.b #$10
CODE_0095F3:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7E8E,x
	BNE.b CODE_009613
	LDA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C0|!EXRAMBankMirror,x
	STA.w $7E8E,x
	LDA.w $7E4E,x
	CLC
	ADC.w #$0002
	STA.w $7E4E,x
	CMP.w #$0014
	BMI.b CODE_009613
	STZ.w $7E4E,x
CODE_009613:
	RTS

;---------------------------------------------------------------------------

DATA_009614:
	db $04,$03,$02,$01,$00,$00,$00

CODE_00961B:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00963A
	DEC.w $7E4C,x
	BMI.b CODE_00963A
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_009614,y
	STA.w $73C2,x
	LDA.b #$04
	STA.w $7782,x
	REP.b #$20
CODE_00963A:
	RTS

;---------------------------------------------------------------------------

DATA_00963B:
	db $04,$04,$04,$04,$04,$04,$04,$03,$03,$02,$02

CODE_009646:
	PHX
	TXA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_009693>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_009693
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_098CB1>>16
	LDA.w #FXCODE_098CB1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009687
	DEC.w $73C2,x
	BPL.b CODE_009674
	JMP.w CODE_008AF8

CODE_009674:
	SEP.b #$20
	LDY.w $73C2,x
	LDA.w DATA_009688,y
	STA.w $7001,x
	LDA.w DATA_00963B,y
	STA.w $7782,x
	REP.b #$20
CODE_009687:
	RTS

DATA_009688:
	db $08,$10,$18,$28,$38,$58,$58,$58,$58,$58,$68

DATA_009693:
	dw DATA_009868,DATA_00985E,DATA_00984F,DATA_009836,DATA_009813,DATA_0097DC,DATA_0097A5,DATA_00976E
	dw DATA_009737,DATA_009700,DATA_0096BF,DATA_0096AB

DATA_0096AB:
	db $08,$08,$6A,$C6,$02,$F8,$08,$6A,$86,$02,$08,$F8,$6A,$46,$02,$F8
	db $F8,$6A,$06,$02

DATA_0096BF:
	db $04,$FC,$45,$06,$00,$00,$08,$55,$06,$00,$04,$04,$42,$C2,$02,$FC
	db $04,$42,$82,$02,$04,$FC,$42,$42,$02,$FC,$FC,$42,$02,$02,$0F,$0D
	db $4C,$06,$00,$00,$0F,$4C,$46,$00,$F7,$06,$4C,$06,$00,$12,$03,$4C
	db $46,$00,$09,$F9,$4C,$46,$00,$FE,$FB,$4C,$46,$00,$04,$06,$4C,$06
	db $00

DATA_009700:
	db $04,$FC,$54,$06,$00,$10,$10,$55,$06,$00,$00,$08,$45,$06,$00,$00
	db $08,$55,$06,$00,$10,$12,$4C,$06,$00,$FF,$14,$4C,$46,$00,$F6,$09
	db $4C,$06,$00,$13,$06,$4C,$46,$00,$0A,$FC,$4C,$46,$00,$FD,$FE,$4C
	db $46,$00,$04,$09,$4C,$06,$00

DATA_009737:
	db $04,$FC,$44,$06,$00,$F8,$10,$55,$06,$00,$00,$08,$54,$06,$00,$10
	db $10,$45,$06,$00,$11,$16,$4C,$06,$00,$FE,$18,$4C,$46,$00,$F5,$0D
	db $4C,$06,$00,$14,$0A,$4C,$46,$00,$0B,$00,$4C,$06,$00,$FC,$02,$4C
	db $46,$00,$04,$0D,$4C,$06,$00

DATA_00976E:
	db $00,$18,$55,$06,$00,$00,$08,$44,$06,$00,$10,$10,$54,$06,$00,$F8
	db $10,$45,$06,$00,$12,$1A,$4C,$06,$00,$FD,$1C,$4D,$46,$00,$F5,$11
	db $4C,$06,$00,$15,$0E,$4D,$46,$00,$0C,$04,$4D,$06,$00,$FB,$06,$4D
	db $46,$00,$04,$11,$4C,$06,$00

DATA_0097A5:
	db $08,$08,$55,$06,$00,$10,$10,$44,$06,$00,$F8,$10,$54,$06,$00,$00
	db $18,$45,$06,$00,$12,$1E,$4D,$06,$00,$FD,$20,$4E,$46,$00,$F4,$15
	db $4D,$06,$00,$15,$12,$4E,$46,$00,$0C,$08,$4E,$06,$00,$FB,$0A,$4E
	db $46,$00,$04,$15,$4C,$06,$00

DATA_0097DC:
	db $10,$20,$55,$06,$00,$F8,$10,$44,$06,$00,$00,$18,$54,$06,$00,$08
	db $08,$45,$06,$00,$12,$23,$4E,$46,$00,$FD,$25,$4F,$46,$00,$F4,$1A
	db $4E,$06,$00,$15,$17,$4F,$46,$00,$0C,$0D,$4F,$06,$00,$FB,$0F,$4F
	db $46,$00,$04,$1A,$4D,$06,$00

DATA_009813:
	db $12,$27,$4F,$46,$00,$F4,$1F,$4F,$06,$00,$04,$1F,$4E,$06,$00,$FC
	db $28,$55,$06,$00,$00,$18,$44,$06,$00,$08,$08,$54,$06,$00,$10,$20
	db $45,$06,$00

DATA_009836:
	db $04,$24,$4F,$06,$00,$08,$30,$55,$06,$00,$FC,$28,$45,$06,$00,$10
	db $20,$54,$06,$00,$08,$08,$44,$06,$00

DATA_00984F:
	db $08,$30,$45,$06,$00,$FC,$28,$54,$06,$00,$10,$20,$44,$06,$00

DATA_00985E:
	db $08,$30,$54,$06,$00,$FC,$28,$44,$06,$00

DATA_009868:
	db $08,$30,$44,$06,$00

;---------------------------------------------------------------------------

CODE_00986D:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009883
	DEC.w $7E4E,x
	BMI.b CODE_009883
	INC.w $73C2,x
	LDA.w $7E4C,x
	STA.w $7782,x
CODE_009883:
	RTS

;---------------------------------------------------------------------------

DATA_009884:
	dw $002C,$003C,$0050,$0064,$0068

DATA_00988E:
	dw $000C,$000C,$0014,$0018,$001C

DATA_009898:
	dw $0004,$0004,$0004,$0005,$0006

DATA_0098A2:
	dw $0000,$0001,$0002,$0001,$0003

CODE_0098AC:
	PHX
	LDA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C0|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C2|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w !EXRAM_YI_Level_AmbSpr_OAMIndex|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w $7E8C,x
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w $70A2,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDA.w $7142,x
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDX.b #FXCODE_089287>>16
	LDA.w #FXCODE_089287
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7E8E,x
	BNE.b CODE_00990F
	INC.w $7E4C,x
	LDA.w $7E4C,x
	ASL
	TAY
	CPY.b #$0A
	BNE.b CODE_0098F4
	LDA.w #$0000
	BRA.b CODE_00990F

CODE_0098F4:
	LDA.w DATA_009884,y
	STA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C0|!EXRAMBankMirror,x
	LDA.w DATA_00988E,y
	STA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C2|!EXRAMBankMirror,x
	LDA.w DATA_009898,y
	STA.w $7E8E,x
	LDA.w DATA_0098A2,y
	STA.w $73C2,x
	LDA.w #$0003
CODE_00990F:
	STA.w $7782,x
	RTS

;---------------------------------------------------------------------------

; Bonus-game 1up popup -- jackpot row head ($22B main).
; The "head" handler when the Bandit minigame's coin-result RNG
; selects the JACKPOT row. Walks DATA_00997A (15-tile sequence)
; one tile per frame; at frame 14 spawns the popup-tail $22D via
; CODE_00995F (the spawn-helper just below). Spawned by
; CODE_11A22B / CODE_11A527 in Bank11 with the RNG result from
; CODE_11A61A.
CODE_009913:
CODE_ambient_main_bonus_1up_jackpot_head:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w #$0001
	STA.w $7782,x
	DEC.w $7E4C,x
	LDA.w $7E4C,x
	BPL.b CODE_009953
	LDA.w #$0001
	STA.w $7E4C,x
	INC.w $7E4E,x
	LDA.w $7E4E,x
	CMP.w #$000F
	BCC.b CODE_009953
	LDA.w #$000E
	STA.w $7E4E,x
	LDA.w $7462,x
	AND.w #$00FF
	CMP.w #$00FF
	BEQ.b CODE_009953
	PHX
	PHY
	JSR.w CODE_ambient_helper_spawn_bonus_1up_popup_tail
	PLY
	PLX
	LDA.w #$00FF
	STA.w $7462,x
CODE_009953:
	LDA.w $7E4E,x
	ASL
	TAY
	LDA.w DATA_00997A,y
	STA.w $73C2,x
	RTS

; Helper: spawn the bonus-game popup tail ($22D) and prime its state
; via CODE_009A96. Called once from CODE_009913 mid-sequence.
CODE_00995F:
CODE_ambient_helper_spawn_bonus_1up_popup_tail:
	LDA.w #!Define_YI_AmbSpr22D
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70A2,x
	STA.w $70A2,y
	LDA.w $7142,x
	STA.w $7142,y
	PHX
	TYX
	JSL.l CODE_ambient_helper_init_1up_popup_state
	PLX
	RTS

DATA_00997A:
	dw $0000,$0001,$0002,$0003,$0004,$0005,$0006,$0007
	dw $0008,$0009,$000A,$000B,$000C,$000E,$000D

;---------------------------------------------------------------------------

; Bonus-game 1up popup -- regular row head ($22C main).
; Bandit minigame "non-jackpot" row. Spawns $22E via Y-speed-threshold
; branch (Bank00:3290) once the slot's Y-speed enters the catch window
; -- $22E is the fade-out particle. Independent of the $22B/$22D chain.
CODE_009998:
CODE_ambient_main_bonus_1up_regular_head:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w #$0002
	STA.w $7782,x
	DEC.w $7E4C,x
	LDA.w $7E4C,x
	BPL.b CODE_0099B8
	LDY.w $7E4E,x
	LDA.w DATA_009A10,y
	AND.w #$00FF
	STA.w $7E4C,x
	INC.w $7E4E,x
CODE_0099B8:
	LDA.w $7E4E,x
	AND.w #$0003
	ASL
	TAY
	LDA.w DATA_009A08,y
	STA.w $73C2,x
	LDA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_009A07
	CMP.w #$0280
	BCC.b CODE_0099D7
	LDA.w #$0000
	STA.w $7782,x
	RTS

CODE_0099D7:
	LDA.w $7E8C,x
	BNE.b CODE_009A07
	INC.w $7E8C,x
	LDA.w #!Define_YI_AmbSpr22E
	JSL.l CODE_spawn_ambient_sprite
	LDA.w $70A2,x
	CLC
	ADC.w #$FFD8
	STA.w $70A2,y
	LDA.w $7142,x
	CLC
	ADC.w #$0000
	STA.w $7142,y
	LDA.w #$0003
	STA.w $7782,y
	PHX
	TYX
	JSL.l CODE_ambient_helper_init_22E_state
	PLX
CODE_009A07:
	RTS

DATA_009A08:
	dw $0000,$0001,$0002,$0001

DATA_009A10:
	db $02,$03,$03,$03,$03,$20,$03,$03
	db $03

;---------------------------------------------------------------------------

; Bonus-game 1up popup -- jackpot popup tail ($22D main).
; Spawned by $22B's helper CODE_00995F. On first frame ($7E8E == 0)
; calls JSL CODE_1191B8 -- the bonus-game state-machine dispatcher
; in Bank11 (jumps via DATA_1191D9 to one of 3 mini-states indexed
; by $10E2); does NOT itself award the 1up (the 1up SFX was already
; queued by $22B's CODE_009A96).
CODE_009A19:
CODE_ambient_main_bonus_1up_popup_tail:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w #$0002
	STA.w $7782,x
	PHX
	DEC.w $7E4C,x
	LDA.w $7E4C,x
	BPL.b CODE_009A49
	LDA.w $7E4E,x
	AND.w #$0001
	CLC
	ADC.w #$0000
	STA.w $7E4C,x
	INC.w $7E4E,x
	LDA.w $7E4E,x
	CMP.w #$000C
	BCC.b CODE_009A49
	LDA.w #$0004
	STA.w $7E4E,x
CODE_009A49:
	LDA.w $7E4E,x
	STA.w $73C2,x
	LDA.w $7E8E,x
	BNE.b CODE_009A61
	PHD
	LDA.w #$0000
	PHA
	PLD
	JSL.l CODE_bonus_game_state_dispatcher
	REP.b #$20
	PLD
CODE_009A61:
	PLX
	STX.w $7E4A
	RTS

;---------------------------------------------------------------------------

; Bonus-game 1up popup -- regular row fade-out final ($22E main).
; Spawned by $22C on the Y-speed-threshold branch (or directly from
; Bank11:4016 outside the within-slot chain). 8-stage countdown then
; despawn.
CODE_009A66:
CODE_ambient_main_bonus_1up_fade_final:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w #$0002
	STA.w $7782,x
	DEC.w $7E4C,x
	LDA.w $7E4C,x
	BPL.b CODE_009A8F
	LDA.w #$0003
	STA.w $7E4C,x
	INC.w $7E4E,x
	LDA.w $7E4E,x
	CMP.w #$0008
	BCC.b CODE_009A8F
	LDA.w #$0000
	STA.w $7782,x
	RTS

CODE_009A8F:
	LDA.w $7E4E,x
	STA.w $73C2,x
	RTS

;---------------------------------------------------------------------------

; Helper: initialise the bonus-game popup tail's state + queue the
; 1up SFX. Called by CODE_00995F immediately after spawning $22D.
; This is the ACTUAL site where SoundID08_1up is queued -- not the
; downstream CODE_1191B8 dispatcher.
CODE_009A96:
CODE_ambient_helper_init_1up_popup_state:
	LDA.w #$0002
	STA.w $7782,x
	LDA.w #$0003
	STA.w $7E4C,x
	STZ.w $7E4E,x
	STZ.w $7502,x
	LDA.w #$0000
	STA.w $7462,x
	LDA.w #$0040
	STA.w $7E8E,x
	LDA.w #!Define_YI_SoundID08_1up
	JSL.l CODE_push_sound_queue
	STX.w $7E4A
	RTL

;---------------------------------------------------------------------------

; Helper: initialise the $22C-spawned $22E's state + queue the
; HitUvula SFX. Called by CODE_009998 immediately after spawning $22E.
CODE_009ABF:
CODE_ambient_helper_init_22E_state:
	LDA.w #$0003
	STA.w $7782,x
	STZ.w $7E4E,x
	STZ.w $7502,x
	LDA.w #$0000
	STA.w $7462,x
	LDA.w #!Define_YI_SoundID3F_HitUvula
	JSL.l CODE_push_sound_queue
	RTL

;---------------------------------------------------------------------------

DATA_009AD9:
	dw $0040,$FFC0

; Wandering generator: physics + sign-flip-every-$40-frames pattern.
; Used by $1FF Goonie aerial-patrol companion and $215 Skeleton Goonie
; patrol companion (both ambient particles that drift in a back-and-
; forth patrol arc). Toggles X-velocity sign on a $40-frame cycle via
; DATA_009AD9 (-$40/+$40); applies ambient physics each frame.
CODE_009ADD:
CODE_ambient_main_wandering_companion:
	JSR.w CODE_008AF2
	LDA.w $7E8E,x
	BNE.b CODE_009AE8
	JMP.w CODE_008AF8

CODE_009AE8:
	CMP.w #$0040
	BPL.b CODE_009AFA
	LDY.b #$FF
	AND.w #$0001
	BEQ.b CODE_009AF6
	LDY.b #$01
CODE_009AF6:
	TYA
	STA.w $7462,x
CODE_009AFA:
	LDA.w $7E8E,x
	AND.w #$003F
	BNE.b CODE_009B12
	LDA.w $73C0,x
	EOR.w #$0002
	STA.w $73C0,x
	TAY
	LDA.w DATA_009AD9,y
	STA.w !EXRAM_YI_Level_AmbSpr_XSpeedLo|!EXRAMBankMirror,x
CODE_009B12:
	RTS

;---------------------------------------------------------------------------

CODE_009B13:
	JSR.w CODE_check_ambient_sprite_freeze
	LDY.w $7462,x
	CPY.b #$FF
	BNE.b CODE_009B25
	LDA.w #$0001
	STA.w $7462,x
	BRA.b CODE_009B52

CODE_009B25:
	LDA.w $7E8C,x
	CLC
	ADC.w $7E4E,x
	STA.w $7E8C,x
	BIT.w #$FF00
	BEQ.b CODE_009B40
	AND.w #$00FF
	STA.w $7E8C,x
	LDA.w #$00FF
	STA.w $7462,x
CODE_009B40:
	LDA.w $7E4E,x
	CLC
	ADC.w #$0004
	CMP.w #$0100
	BMI.b CODE_009B4F
	LDA.w #$0100
CODE_009B4F:
	STA.w $7E4E,x
CODE_009B52:
	RTS

;---------------------------------------------------------------------------

DATA_009B53:
	db $0C,$10

CODE_009B55:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009B71
	DEC.w $73C2,x
	BPL.b CODE_009B65
	JMP.w CODE_008AF8

CODE_009B65:
	LDY.w $73C2,x
	LDA.w DATA_009B53,y
	AND.w #$00FF
	STA.w $7782,x
CODE_009B71:
	RTS

;---------------------------------------------------------------------------

DATA_009B72:
	db $03,$03,$03,$03,$03,$03,$03,$03
	db $03,$02,$02,$02,$02,$02,$02,$02
	db $02,$02,$02,$02,$02,$02

CODE_009B88:
	JSR.w CODE_check_ambient_sprite_freeze
	SEP.b #$20
	LDA.w $7782,x
	BEQ.b CODE_009BA1
	LDY.w $73C2,x
	CPY.b #$16
	BNE.b CODE_009BB4
	CMP.b #$02
	BCS.b CODE_009BB4
	LDA.b #$FF
	BRA.b CODE_009BB6

CODE_009BA1:
	DEC.w $73C2,x
	BPL.b CODE_009BAB
	REP.b #$20
	JMP.w CODE_008AF8

CODE_009BAB:
	LDY.w $73C2,x
	LDA.w DATA_009B72,y
	STA.w $7782,x
CODE_009BB4:
	LDA.b #$05
CODE_009BB6:
	STA.w $7462,x
	REP.b #$20
	RTS

;---------------------------------------------------------------------------

CODE_009BBC:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009BC7
	JMP.w CODE_008AF8

CODE_009BC7:
	LDA.w $7E8E,x
	BNE.b CODE_009BDD
	LDA.w #$0004
	STA.w $7E8E,x
	DEC.w $73C2,x
	BPL.b CODE_009BDD
	LDA.w #$0005
	STA.w $73C2,x
CODE_009BDD:
	RTS

;---------------------------------------------------------------------------

DATA_009BDE:
	db $08,$06,$04,$02,$02

CODE_009BE3:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009C10
	DEC.w $7E4C,x
	BPL.b CODE_009BF3
	JMP.w CODE_008AF8

CODE_009BF3:
	SEP.b #$20
	DEC.w $73C2,x
	LDY.w $7E4C,x
	LDA.w DATA_009BDE,y
	STA.w $7782,x
	REP.b #$20
	LDA.w #$0001
	CPY.b #$03
	BNE.b CODE_009C0D
	LDA.w #$FFFF
CODE_009C0D:
	STA.w $7462,x
CODE_009C10:
	RTS

;---------------------------------------------------------------------------

DATA_009C11:
	db $03,$03,$03,$03,$03,$03,$03,$02
	db $02,$02,$02,$02

CODE_009C1D:
	PHX
	TXA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_009C6B>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_009C6B
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_098CB1>>16
	LDA.w #FXCODE_098CB1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009C5E
	DEC.w $73C2,x
	BPL.b CODE_009C4B
	JMP.w CODE_008AF8

CODE_009C4B:
	SEP.b #$20
	LDY.w $73C2,x
	LDA.w DATA_009C5F,y
	STA.w $7001,x
	LDA.w DATA_009C11,y
	STA.w $7782,x
	REP.b #$20
CODE_009C5E:
	RTS

DATA_009C5F:
	db $10,$10,$20,$38,$48,$58,$58,$50,$58,$50,$50,$48

DATA_009C6B:
	dw DATA_009E88,DATA_009E7E,DATA_009E6A,DATA_009E47,DATA_009E1A,DATA_009DE3,DATA_009DAC,DATA_009D7A
	dw DATA_009D43,DATA_009D11,DATA_009CDF,DATA_009CB2,DATA_009C85

DATA_009C85:
	db $03,$FE,$55,$06,$00,$09,$0B,$4C,$04,$00,$09,$00,$4C,$04,$00,$FF
	db $01,$4C,$04,$00,$05,$07,$4C,$04,$00,$0E,$07,$4C,$04,$00,$00,$0B
	db $4C,$04,$00,$FE,$06,$4C,$04,$00,$04,$FD,$4D,$04,$00

DATA_009CB2:
	db $03,$FE,$55,$06,$00,$0A,$0D,$4C,$04,$00,$0A,$FD,$4C,$04,$00,$FE
	db $FE,$4C,$04,$00,$05,$08,$4C,$04,$00,$10,$06,$4C,$04,$00,$FF,$0C
	db $4D,$84,$00,$FC,$07,$4C,$04,$00,$04,$FE,$4D,$04,$00

DATA_009CDF:
	db $0C,$02,$55,$06,$00,$03,$FE,$45,$06,$00,$0A,$0F,$4C,$04,$00,$09
	db $FB,$4D,$44,$00,$FD,$FD,$4C,$04,$00,$05,$09,$4C,$04,$00,$12,$06
	db $4D,$04,$00,$FE,$0D,$4E,$84,$00,$FA,$08,$4C,$04,$00,$04,$FF,$4D
	db $04,$00

DATA_009D11:
	db $0C,$02,$55,$06,$00,$03,$FE,$54,$06,$00,$0B,$12,$4D,$44,$00,$0B
	db $FA,$4D,$44,$00,$FD,$FD,$4C,$04,$00,$05,$0B,$4C,$04,$00,$13,$06
	db $4D,$04,$00,$FE,$0F,$4E,$84,$00,$FA,$0A,$4D,$04,$00,$04,$01,$4E
	db $04,$00

DATA_009D43:
	db $FC,$08,$55,$06,$00,$0C,$02,$45,$06,$00,$03,$FE,$44,$06,$00,$0C
	db $15,$4D,$44,$00,$0C,$FA,$4D,$44,$00,$FC,$FE,$4C,$04,$00,$05,$0D
	db $4C,$04,$00,$14,$07,$4D,$04,$00,$FD,$11,$4F,$84,$00,$F9,$0C,$4D
	db $04,$00,$04,$03,$4E,$04,$00

DATA_009D7A:
	db $FC,$08,$55,$06,$00,$0C,$02,$54,$06,$00,$0C,$19,$4E,$44,$00,$0C
	db $FB,$4E,$44,$00,$FC,$FF,$4D,$44,$00,$05,$10,$4D,$44,$00,$15,$08
	db $4D,$04,$00,$FD,$14,$4F,$84,$00,$F9,$0F,$4D,$04,$00,$04,$06,$4E
	db $04,$00

DATA_009DAC:
	db $07,$16,$55,$06,$00,$FC,$08,$55,$06,$00,$0C,$02,$44,$06,$00,$0D
	db $1D,$4E,$44,$00,$0D,$FC,$4E,$44,$00,$FB,$01,$4E,$44,$00,$05,$13
	db $4E,$44,$00,$15,$09,$4E,$04,$00,$FC,$17,$4F,$84,$00,$F8,$12,$4E
	db $04,$00,$04,$09,$4F,$04,$00

DATA_009DE3:
	db $07,$17,$55,$06,$00,$FC,$09,$55,$06,$00,$0C,$03,$44,$06,$00,$0D
	db $1F,$4F,$44,$00,$0D,$FE,$4F,$44,$00,$FB,$03,$4E,$44,$00,$05,$15
	db $4E,$44,$00,$16,$0A,$4E,$04,$00,$FC,$19,$4F,$84,$00,$F8,$14,$4E
	db $04,$00,$04,$0A,$4F,$04,$00

DATA_009E1A:
	db $03,$20,$44,$06,$00,$07,$16,$45,$06,$00,$FC,$08,$54,$06,$00,$0D
	db $22,$4F,$44,$00,$0E,$01,$4F,$44,$00,$FB,$05,$4F,$44,$00,$05,$19
	db $4E,$44,$00,$17,$0D,$4E,$04,$00,$F7,$17,$4F,$04,$00

DATA_009E47:
	db $17,$10,$4F,$04,$00,$03,$20,$54,$06,$00,$07,$16,$54,$06,$00,$FC
	db $08,$44,$06,$00,$0E,$05,$4F,$44,$00,$F7,$1A,$4F,$04,$00,$05,$1C
	db $4F,$44,$00

DATA_009E6A:
	db $18,$12,$4F,$04,$00,$03,$20,$45,$06,$00,$07,$16,$44,$06,$00,$05
	db $1F,$4F,$44,$00

DATA_009E7E:
	db $03,$20,$54,$06,$00,$05,$22,$4F,$44,$00

DATA_009E88:
	db $03,$20,$44,$06,$00,$05,$25,$4F,$44,$00

;---------------------------------------------------------------------------

CODE_009E92:
	PHX
	TXA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_009EE0>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_009EE0
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_098CB1>>16
	LDA.w #FXCODE_098CB1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_009ED2
	DEC.w $73C2,x
	BPL.b CODE_009EC0
	JMP.w CODE_008AF8

CODE_009EC0:
	SEP.b #$20
	LDY.w $73C2,x
	LDA.w DATA_009ED3,y
	STA.w $7001,x
	LDA.b #$02
	STA.w $7782,x
	REP.b #$20
CODE_009ED2:
	RTS

DATA_009ED3:
	db $10,$20,$30,$40,$50,$50,$48,$50,$60,$58,$50,$60,$60

DATA_009EE0:
	dw DATA_00A172,DATA_00A15E,DATA_00A140,DATA_00A118,DATA_00A0E6,DATA_00A0B4,DATA_00A087,DATA_00A055
	dw DATA_00A019,DATA_009FE2,DATA_009FB0,DATA_009F74,DATA_009F38,DATA_009EFC

DATA_009EFC:
	db $07,$08,$42,$C2,$02,$F7,$08,$42,$82,$02,$07,$F8,$42,$42,$02,$F7
	db $F8,$42,$02,$02,$09,$01,$86,$08,$02,$FF,$08,$86,$08,$02,$F5,$FE
	db $86,$08,$02,$01,$F6,$86,$08,$02,$0C,$09,$86,$08,$02,$F5,$0A,$86
	db $08,$02,$0B,$F4,$86,$08,$02,$F6,$F3,$86,$08,$02

DATA_009F38:
	db $05,$05,$42,$C2,$02,$FD,$05,$42,$82,$02,$05,$FD,$42,$42,$02,$FD
	db $FD,$42,$02,$02,$11,$01,$86,$08,$02,$FF,$10,$86,$08,$02,$ED,$FE
	db $86,$08,$02,$01,$F2,$86,$08,$02,$10,$0D,$86,$08,$02,$F1,$0E,$86
	db $08,$02,$0D,$EE,$86,$08,$02,$F4,$ED,$86,$08,$02

DATA_009F74:
	db $08,$08,$6A,$C6,$02,$F8,$08,$6A,$86,$02,$08,$F8,$6A,$46,$02,$F8
	db $F8,$6A,$06,$02,$15,$03,$86,$08,$02,$FF,$14,$86,$08,$02,$E9,$FF
	db $86,$08,$02,$01,$F0,$86,$08,$02,$14,$0F,$86,$08,$02,$EF,$10,$86
	db $08,$02,$0F,$EC,$86,$08,$02,$F2,$EB,$86,$08,$02

DATA_009FB0:
	db $08,$08,$E3,$06,$02,$F8,$00,$E3,$06,$02,$19,$05,$86,$08,$02,$FF
	db $1A,$86,$08,$02,$E5,$01,$86,$08,$02,$01,$EE,$E3,$06,$02,$16,$12
	db $86,$08,$02,$ED,$13,$86,$08,$02,$11,$EA,$86,$08,$02,$F0,$E9,$86
	db $08,$02

DATA_009FE2:
	db $08,$F8,$E3,$06,$02,$08,$08,$E5,$06,$02,$F8,$00,$E5,$06,$02,$1D
	db $07,$86,$08,$02,$FF,$1E,$E3,$06,$02,$E1,$03,$86,$08,$02,$01,$ED
	db $E5,$06,$02,$18,$16,$86,$08,$02,$EB,$17,$86,$08,$02,$13,$E9,$86
	db $08,$02,$EE,$E8,$86,$08,$02

DATA_00A019:
	db $00,$00,$E3,$06,$02,$08,$F8,$E5,$06,$02,$08,$08,$E5,$06,$02,$F8
	db $00,$E7,$06,$02,$21,$09,$86,$08,$02,$FF,$24,$E5,$06,$02,$DD,$05
	db $86,$08,$02,$01,$ED,$E7,$06,$02,$1A,$1A,$86,$08,$02,$E9,$1B,$86
	db $08,$02,$15,$E9,$86,$08,$02,$EC,$E8,$86,$08,$02

DATA_00A055:
	db $00,$10,$E3,$06,$02,$00,$00,$E5,$06,$02,$08,$F8,$E7,$06,$02,$24
	db $0C,$E3,$06,$02,$FF,$2A,$E7,$06,$02,$DA,$08,$86,$08,$02,$1D,$20
	db $86,$08,$02,$E6,$21,$86,$08,$02,$18,$EA,$86,$08,$02,$E9,$E9,$86
	db $08,$02

DATA_00A087:
	db $F0,$08,$E3,$06,$02,$00,$10,$E5,$06,$02,$00,$00,$E7,$06,$02,$26
	db $0F,$E5,$06,$02,$D8,$0B,$86,$08,$02,$1F,$25,$86,$08,$02,$E4,$26
	db $86,$08,$02,$1A,$EC,$86,$08,$02,$E7,$EB,$E3,$06,$02

DATA_00A0B4:
	db $E8,$18,$E3,$06,$02,$08,$20,$E3,$06,$02,$F0,$08,$E5,$06,$02,$00
	db $10,$E7,$06,$02,$28,$14,$E7,$06,$02,$D6,$10,$86,$08,$02,$21,$2C
	db $86,$08,$02,$E2,$2D,$E3,$06,$02,$1C,$EF,$86,$08,$02,$E5,$EE,$E5
	db $06,$02

DATA_00A0E6:
	db $18,$10,$E3,$06,$02,$E8,$18,$E5,$06,$02,$08,$20,$E5,$06,$02,$F0
	db $08,$E7,$06,$02,$00,$10,$E7,$06,$02,$D5,$15,$86,$08,$02,$22,$32
	db $86,$08,$02,$E1,$33,$E5,$06,$02,$1D,$F3,$E5,$06,$02,$E4,$F2,$E7
	db $06,$02

DATA_00A118:
	db $00,$38,$E3,$06,$02,$18,$10,$E5,$06,$02,$E8,$18,$E7,$06,$02,$08
	db $20,$E7,$06,$02,$D3,$1B,$86,$08,$02,$24,$38,$E3,$06,$02,$E0,$39
	db $E7,$06,$02,$1F,$F9,$E5,$06,$02

DATA_00A140:
	db $08,$10,$E3,$06,$02,$00,$38,$E5,$06,$02,$18,$10,$E7,$06,$02,$D3
	db $21,$E3,$06,$02,$24,$3E,$E5,$06,$02,$1F,$FF,$E7,$06,$02

DATA_00A15E:
	db $08,$10,$E5,$06,$02,$00,$38,$E7,$06,$02,$D2,$27,$E5,$06,$02,$25
	db $44,$E7,$06,$02

DATA_00A172:
	db $08,$10,$E7,$06,$02,$D1,$2D,$E7,$06,$02

;---------------------------------------------------------------------------

DATA_00A17C:
	db $04,$04,$04,$04,$04,$04,$04,$04
	db $04,$04,$04,$04,$04,$04,$04,$03
	db $03,$03,$02,$02,$01,$01,$01

CODE_00A193:
	PHX
	TXA
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_00A1E9>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_00A1E9
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_098CB1>>16
	LDA.w #FXCODE_098CB1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A1D1
	DEC.w $73C2,x
	BPL.b CODE_00A1BE
	JMP.w CODE_008AF8

CODE_00A1BE:
	SEP.b #$20
	LDY.w $73C2,x
	LDA.w DATA_00A1D2,y
	STA.w $7001,x
	LDA.w DATA_00A17C,y
	STA.w $7782,x
	REP.b #$20
CODE_00A1D1:
	RTS

DATA_00A1D2:
	db $08,$10,$18,$20,$28,$30,$40,$38,$40,$40,$40,$40,$40,$40,$40,$40
	db $40,$40,$40,$40,$40,$40,$40

DATA_00A1E9:
	dw DATA_00A548,DATA_00A53E,DATA_00A52F,DATA_00A51B,DATA_00A502,DATA_00A4E4,DATA_00A4BC,DATA_00A499
	dw DATA_00A471,DATA_00A449,DATA_00A421,DATA_00A3F9,DATA_00A3D1,DATA_00A3A9,DATA_00A381,DATA_00A359
	dw DATA_00A331,DATA_00A309,DATA_00A2E1,DATA_00A2B9,DATA_00A291,DATA_00A269,DATA_00A241,DATA_00A219

DATA_00A219:
	db $02,$00,$11,$00,$00,$FC,$00,$10,$00,$00,$04,$FC,$01,$00,$00,$FC
	db $FC,$00,$00,$00,$FB,$00,$11,$00,$00,$F8,$00,$10,$00,$00,$FB,$FA
	db $01,$00,$00,$F6,$FC,$00,$00,$00

DATA_00A241:
	db $06,$03,$01,$00,$00,$FC,$05,$10,$40,$00,$08,$F7,$10,$00,$00,$FC
	db $F7,$10,$00,$00,$FB,$00,$11,$40,$00,$F3,$03,$10,$40,$00,$FB,$F1
	db $01,$40,$00,$F2,$F7,$01,$00,$00

DATA_00A269:
	db $09,$03,$10,$40,$00,$FC,$08,$00,$40,$00,$0B,$F5,$10,$40,$00,$FC
	db $F4,$11,$00,$00,$FB,$01,$10,$40,$00,$F0,$03,$10,$00,$00,$FB,$ED
	db $01,$C0,$00,$EF,$F4,$01,$80,$00

DATA_00A291:
	db $0C,$04,$01,$40,$00,$FC,$08,$01,$40,$00,$0D,$F3,$01,$40,$00,$FC
	db $F3,$10,$40,$00,$FB,$02,$00,$40,$00,$ED,$04,$00,$00,$00,$FB,$EB
	db $00,$C0,$00,$ED,$F2,$10,$80,$00

DATA_00A2B9:
	db $0D,$05,$00,$C0,$00,$FC,$0A,$01,$C0,$00,$0E,$F2,$01,$C0,$00,$FC
	db $F3,$00,$40,$00,$FB,$03,$01,$40,$00,$EC,$05,$01,$00,$00,$FB,$E9
	db $11,$80,$00,$EC,$F1,$10,$C0,$00

DATA_00A2E1:
	db $0E,$06,$11,$80,$00,$FB,$0C,$00,$C0,$00,$0F,$F1,$00,$C0,$00,$FC
	db $F3,$00,$C0,$00,$FB,$04,$01,$C0,$00,$EB,$06,$01,$80,$00,$FB,$E8
	db $10,$80,$00,$EB,$F0,$01,$C0,$00

DATA_00A309:
	db $0E,$06,$01,$80,$00,$FC,$0C,$11,$80,$00,$0F,$F1,$11,$80,$00,$FC
	db $F3,$11,$80,$00,$FB,$05,$00,$C0,$00,$EB,$06,$00,$80,$00,$FB,$E8
	db $00,$80,$00,$EB,$F0,$00,$40,$00

DATA_00A331:
	db $0D,$0A,$10,$00,$00,$FD,$0F,$10,$80,$00,$10,$F2,$10,$80,$00,$FE
	db $F6,$00,$80,$00,$FB,$06,$11,$80,$00,$EB,$07,$11,$80,$00,$FC,$EB
	db $01,$00,$00,$ED,$F4,$11,$00,$00

DATA_00A359:
	db $0C,$0E,$10,$40,$00,$FE,$13,$00,$80,$00,$11,$F6,$01,$00,$00,$FE
	db $F8,$00,$00,$00,$FD,$09,$00,$80,$00,$E9,$09,$00,$C0,$00,$FC,$EE
	db $10,$00,$00,$EF,$F3,$00,$00,$00

DATA_00A381:
	db $0B,$0E,$00,$40,$00,$FE,$16,$01,$00,$00,$10,$F9,$00,$00,$00,$FC
	db $FB,$11,$00,$00,$FD,$0C,$00,$00,$00,$E9,$0C,$00,$40,$00,$FA,$F2
	db $11,$00,$00,$EE,$F3,$01,$00,$00

DATA_00A3A9:
	db $0A,$0F,$01,$40,$00,$FD,$19,$10,$00,$00,$0F,$FE,$11,$00,$00,$FB
	db $FB,$00,$40,$00,$FB,$0F,$11,$00,$00,$EB,$10,$11,$00,$00,$FA,$F2
	db $10,$40,$00,$EE,$F4,$01,$00,$00

DATA_00A3D1:
	db $09,$10,$01,$40,$00,$FB,$1A,$00,$40,$00,$0E,$FD,$00,$40,$00,$FA
	db $FC,$01,$40,$00,$F9,$10,$00,$40,$00,$EC,$11,$00,$00,$00,$F9,$F3
	db $00,$40,$00,$ED,$F6,$00,$00,$00

DATA_00A3F9:
	db $0B,$13,$00,$40,$00,$FA,$1D,$01,$40,$00,$0D,$FE,$01,$40,$00,$FB
	db $FE,$01,$C0,$00,$FA,$11,$01,$40,$00,$ED,$11,$01,$00,$00,$F9,$F3
	db $01,$40,$00,$EB,$FC,$10,$00,$00

DATA_00A421:
	db $0C,$16,$10,$40,$00,$F9,$1E,$01,$40,$00,$0D,$FF,$01,$40,$00,$FB
	db $00,$00,$C0,$00,$FA,$12,$01,$C0,$00,$ED,$13,$01,$00,$00,$F9,$F5
	db $01,$40,$00,$E9,$FE,$11,$00,$00

DATA_00A449:
	db $0D,$19,$11,$00,$00,$FA,$20,$00,$40,$00,$0E,$02,$00,$40,$00,$FB
	db $01,$10,$C0,$00,$FA,$15,$01,$C0,$00,$EC,$16,$00,$00,$00,$FA,$F8
	db $00,$40,$00,$E9,$FD,$10,$40,$00

DATA_00A471:
	db $0F,$1A,$10,$00,$00,$FB,$23,$10,$40,$00,$0E,$05,$10,$40,$00,$FC
	db $03,$10,$C0,$00,$FA,$17,$01,$40,$00,$EC,$19,$10,$00,$00,$FB,$FB
	db $10,$40,$00,$E9,$FD,$00,$40,$00

DATA_00A499:
	db $11,$1C,$01,$00,$00,$FD,$26,$00,$00,$00,$11,$08,$01,$00,$00,$FB
	db $09,$00,$C0,$00,$FB,$1C,$10,$00,$00,$E9,$1C,$00,$40,$00,$E9,$00
	db $01,$40,$00

DATA_00A4BC:
	db $10,$1B,$00,$00,$00,$FC,$25,$10,$00,$00,$10,$09,$10,$00,$00,$FC
	db $06,$10,$C0,$00,$FB,$1A,$10,$40,$00,$EA,$1B,$10,$40,$00,$FB,$FD
	db $11,$00,$00,$E9,$FE,$01,$40,$00

DATA_00A4E4:
	db $12,$1D,$01,$00,$00,$FE,$28,$01,$00,$00,$11,$09,$01,$00,$00,$FB
	db $0B,$00,$C0,$00,$FD,$1D,$01,$00,$00,$E9,$04,$00,$40,$00

DATA_00A502:
	db $11,$21,$00,$00,$00,$10,$0C,$00,$00,$00,$FA,$0E,$01,$C0,$00,$FD
	db $1E,$01,$00,$00,$EA,$07,$10,$40,$00

DATA_00A51B:
	db $10,$0E,$10,$00,$00,$FB,$11,$01,$40,$00,$FC,$22,$10,$00,$00,$EA
	db $0A,$10,$00,$00

DATA_00A52F:
	db $0F,$13,$11,$00,$00,$FB,$25,$11,$00,$00,$EB,$0A,$00,$00,$00

DATA_00A53E:
	db $FA,$26,$10,$40,$00,$EB,$0B,$01,$00,$00

DATA_00A548:
	db $F9,$27,$01,$40,$00

;---------------------------------------------------------------------------

DATA_00A54D:
	db $00,$F8,$00,$08

CODE_00A551:
	JSR.w CODE_check_ambient_sprite_freeze
	LDY.b #$00
	LDA.w $7142,x
	CMP.w $7E4C,x
	BPL.b CODE_00A560
	INY
	INY
CODE_00A560:
	LDA.w DATA_00A54D,y
	STA.w $75A2,x
	RTS

;---------------------------------------------------------------------------

DATA_00A567:
	db $07,$07,$05,$04,$04,$04,$04,$04

CODE_00A56F:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A58B
	DEC.w $73C2,x
	BPL.b CODE_00A57F
	JMP.w CODE_008AF8

CODE_00A57F:
	LDY.w $73C2,x
	LDA.w DATA_00A567,y
	AND.w #$00FF
	STA.w $7782,x
CODE_00A58B:
	RTS

;---------------------------------------------------------------------------

DATA_00A58C:
	db $06,$06,$06,$06,$06,$05,$05,$05
	db $05,$05,$05,$04,$04,$04

CODE_00A59A:
	PHX
	TXA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_00A5EB>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_00A5EB
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_098CB1>>16
	LDA.w #FXCODE_098CB1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	PLX
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A5DB
	DEC.w $73C2,x
	BPL.b CODE_00A5C8
	JMP.w CODE_008AF8

CODE_00A5C8:
	SEP.b #$20
	LDY.w $73C2,x
	LDA.w DATA_00A5DC,y
	STA.w $7001,x
	LDA.w DATA_00A58C,y
	STA.w $7782,x
	REP.b #$20
CODE_00A5DB:
	RTS

DATA_00A5DC:
	db $08,$08,$08,$10,$18,$20,$18,$18,$18,$18,$10,$10,$10,$08,$08

DATA_00A5EB:
	dw DATA_00A6A4,DATA_00A69F,DATA_00A69A,DATA_00A690,DATA_00A681,DATA_00A66D,DATA_00A65E,DATA_00A64F
	dw DATA_00A640,DATA_00A631,DATA_00A627,DATA_00A61D,DATA_00A613,DATA_00A60E,DATA_00A609

DATA_00A609:
	db $00,$00,$E3,$06,$02

DATA_00A60E:
	db $00,$01,$E3,$06,$02

DATA_00A613:
	db $00,$00,$F8,$06,$00,$00,$03,$E3,$06,$02

DATA_00A61D:
	db $00,$00,$F8,$46,$00,$00,$06,$E3,$06,$02

DATA_00A627:
	db $00,$00,$F8,$06,$00,$00,$0A,$E5,$06,$02

DATA_00A631:
	db $08,$09,$F8,$06,$00,$00,$01,$F7,$46,$00,$00,$0E,$E5,$46,$02

DATA_00A640:
	db $08,$0A,$F8,$46,$00,$00,$03,$F7,$06,$00,$00,$12,$E5,$06,$02

DATA_00A64F:
	db $08,$0C,$F7,$06,$00,$00,$05,$F7,$46,$00,$00,$16,$E5,$46,$02

DATA_00A65E:
	db $08,$0E,$F7,$46,$00,$00,$07,$F7,$06,$00,$00,$1A,$E7,$06,$02

DATA_00A66D:
	db $00,$0B,$E1,$06,$00,$04,$18,$F8,$06,$00,$08,$10,$E1,$06,$00,$00
	db $1E,$E7,$46,$02

DATA_00A681:
	db $04,$19,$F8,$46,$00,$08,$12,$E1,$06,$00,$00,$22,$E7,$86,$02

DATA_00A690:
	db $04,$1B,$F8,$06,$00,$00,$26,$E7,$C6,$02

DATA_00A69A:
	db $04,$1D,$59,$06,$00

DATA_00A69F:
	db $04,$1F,$F7,$46,$00

DATA_00A6A4:
	db $04,$21,$E1,$06,$00

;---------------------------------------------------------------------------

CODE_00A6A9:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A6B4
	JMP.w CODE_008AF8

CODE_00A6B4:
	LDA.w $7E8E,x
	BNE.b CODE_00A6CD
	SEP.b #$20
	LDA.b #$02
	STA.w $7E8E,x
	DEC.w $73C2,x
	BPL.b CODE_00A6CB
	LDA.w $7E4C,x
	STA.w $73C2,x
CODE_00A6CB:
	REP.b #$20
CODE_00A6CD:
	RTS

;---------------------------------------------------------------------------

CODE_00A6CE:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7820,x
	AND.w #$0001
	BEQ.b CODE_00A701
	LDA.w $73C2,x
	BNE.b CODE_00A6E4
	LDA.w #$001C
	STA.w $6F62,x
CODE_00A6E4:
	CMP.w #$0003
	BEQ.b CODE_00A6EC
	INC.w $73C2,x
CODE_00A6EC:
	LDA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
	BMI.b CODE_00A701
	LSR
	CMP.w #$0020
	BCS.b CODE_00A6FA
	JMP.w CODE_008AF8

CODE_00A6FA:
	EOR.w #$FFFF
	INC
	STA.w !EXRAM_YI_Level_AmbSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_00A701:
	RTS

;---------------------------------------------------------------------------

DATA_00A702:
	db $0A,$09,$08,$07,$06,$05,$04,$03
	db $02,$01,$00,$00

DATA_00A70E:
	db $04,$04,$03,$03,$02,$02,$01,$01
	db $01,$01,$01,$01

DATA_00A71A:
	db $01,$01,$01,$01,$01,$01,$01,$01
	db $01,$01,$FF,$01

CODE_00A726:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A74F
	DEC.w $7E4C,x
	BPL.b CODE_00A736
	JMP.w CODE_008AF8

CODE_00A736:
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_00A702,y
	STA.w $73C2,x
	LDA.w DATA_00A70E,y
	STA.w $7782,x
	LDA.w DATA_00A71A,y
	STA.w $7462,x
	REP.b #$20
CODE_00A74F:
	RTS

;---------------------------------------------------------------------------

DATA_00A750:
	db $03,$03,$03,$03,$03,$03,$03,$02,$02

CODE_00A759:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A775
	DEC.w $73C2,x
	BPL.b CODE_00A769
	JMP.w CODE_008AF8

CODE_00A769:
	LDY.w $73C2,x
	LDA.w DATA_00A750,y
	AND.w #$00FF
	STA.w $7782,x
CODE_00A775:
	RTS

;---------------------------------------------------------------------------

CODE_00A776:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A78C
	DEC.w $73C2,x
	BPL.b CODE_00A786
	JMP.w CODE_008AF8

CODE_00A786:
	LDA.w #$0003
	STA.w $7782,x
CODE_00A78C:
	RTS

;---------------------------------------------------------------------------

CODE_00A78D:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A7A3
	DEC.w $73C2,x
	BPL.b CODE_00A79D
	JMP.w CODE_008AF8

CODE_00A79D:
	LDA.w #$0004
	STA.w $7782,x
CODE_00A7A3:
	RTS

;---------------------------------------------------------------------------

CODE_00A7A4:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A7D0
	SEP.b #$20
	LDA.b #$01
	STA.w $7462,x
	REP.b #$20
	LDA.w #$0004
	STA.w $7782,x
	DEC.w $73C2,x
	BPL.b CODE_00A7D0
	LDA.w #$0001
	STA.w $73C2,x
	LDA.w $7142,x
	CLC
	ADC.w #$0008
	STA.w $7142,x
CODE_00A7D0:
	RTS

;---------------------------------------------------------------------------

DATA_00A7D1:
	db $03,$03,$02,$02,$02,$01,$01,$01,$02

CODE_00A7DA:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A7F6
	DEC.w $73C2,x
	BPL.b CODE_00A7EA
	JMP.w CODE_008AF8

CODE_00A7EA:
	LDY.w $73C2,x
	LDA.w DATA_00A7D1,y
	AND.w #$00FF
	STA.w $7782,x
CODE_00A7F6:
	RTS

;---------------------------------------------------------------------------

CODE_00A7F7:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A80D
	DEC.w $73C2,x
	BPL.b CODE_00A807
	JMP.w CODE_008AF8

CODE_00A807:
	LDA.w #$0002
	STA.w $7782,x
CODE_00A80D:
	RTS

;---------------------------------------------------------------------------

CODE_00A80E:
	JSR.w CODE_008AF2
	RTS

;---------------------------------------------------------------------------

DATA_00A812:
	db $2C,$28,$24,$20,$1C,$18,$FF,$14
	db $FF,$10,$FF,$0C,$FF,$08,$FF,$04
	db $FF,$00

DATA_00A824:
	db $04,$04,$04,$04,$04,$04,$02,$02
	db $02,$02,$02,$02,$02,$02,$02,$02
	db $02

CODE_00A835:
	LDY.w $7E4C,x
	LDA.w DATA_00A812-$01,y
	BMI.b CODE_00A890
	XBA
	ORA.w $7E4E,x
	AND.w #$00FF
	STA.w $73C2,x
	STX.b $00
	TXA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDA.w #DATA_00A8AE>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #DATA_00A8AE
	STA.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDX.b #FXCODE_098CB1>>16
	LDA.w #FXCODE_098CB1
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $00
	LDA.w #$0004
	STA.w !REGISTER_SuperFX_R7_MERGEXPosLo
	LDA.w $70A2,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.w $7142,x
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w !EXRAM_YI_Level_AmbSpr_GenericTable7018C2|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w !EXRAM_YI_Level_AmbSpr_OAMIndex|!EXRAMBankMirror,x
	STA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	LDX.b #FXCODE_09F5F4>>16
	LDA.w #FXCODE_09F5F4
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDX.b $00
CODE_00A890:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00A8AD
	DEC.w $7E4C,x
	BPL.b CODE_00A8A0
	JMP.w CODE_008AF8

CODE_00A8A0:
	SEP.b #$20
	LDY.w $7E4C,x
	LDA.w DATA_00A824,y
	STA.w $7782,x
	REP.b #$20
CODE_00A8AD:
	RTS

DATA_00A8AE:
	dw DATA_00A90E,DATA_00AA12,DATA_00AB16,DATA_00AC1A,DATA_00A922,DATA_00AA26,DATA_00AB2A,DATA_00AC2E
	dw DATA_00A936,DATA_00AA3A,DATA_00AB3E,DATA_00AC42,DATA_00A94A,DATA_00AA4E,DATA_00AB52,DATA_00AC56
	dw DATA_00A95E,DATA_00AA62,DATA_00AB66,DATA_00AC6A,DATA_00A972,DATA_00AA76,DATA_00AB7A,DATA_00AC7E
	dw DATA_00A986,DATA_00AA8A,DATA_00AB8E,DATA_00AC92,DATA_00A99A,DATA_00AA9E,DATA_00ABA2,DATA_00ACA6
	dw DATA_00A9AE,DATA_00AAB2,DATA_00ABB6,DATA_00ACBA,DATA_00A9C2,DATA_00AAC6,DATA_00ABCA,DATA_00ACCE
	dw DATA_00A9D6,DATA_00AADA,DATA_00ABDE,DATA_00ACE2,DATA_00A9EA,DATA_00AAEE,DATA_00ABF2,DATA_00ACF6

DATA_00A90E:
	db $FC,$00,$42,$C2,$02,$FC,$F0,$42,$42,$02,$EC,$00,$42,$82,$02,$EC
	db $F0,$42,$02,$02

DATA_00A922:
	db $0C,$FC,$42,$C2,$02,$FC,$FC,$42,$82,$02,$0C,$EC,$42,$42,$02,$FC
	db $EC,$42,$02,$02

DATA_00A936:
	db $14,$08,$42,$C2,$02,$14,$F8,$42,$42,$02,$04,$08,$42,$82,$02,$04
	db $F8,$42,$02,$02

DATA_00A94A:
	db $0C,$14,$42,$C2,$02,$FC,$14,$42,$82,$02,$0C,$04,$42,$42,$02,$FC
	db $04,$42,$02,$02

DATA_00A95E:
	db $FC,$10,$42,$C2,$02,$EC,$10,$42,$82,$02,$FC,$00,$42,$42,$02,$EC
	db $00,$42,$02,$02

DATA_00A972:
	db $08,$08,$42,$C2,$02,$F8,$08,$42,$82,$02,$08,$F8,$42,$42,$02,$F8
	db $F8,$42,$02,$02

DATA_00A986:
	db $08,$04,$E3,$06,$02,$FC,$08,$E3,$06,$02,$04,$FC,$E3,$06,$02,$F8
	db $F8,$E3,$06,$02

DATA_00A99A:
	db $08,$02,$E3,$06,$02,$FC,$06,$E3,$06,$02,$04,$FA,$E3,$06,$02,$F8
	db $F6,$E5,$06,$02

DATA_00A9AE:
	db $08,$00,$E5,$06,$02,$FC,$04,$E3,$06,$02,$04,$F8,$E3,$06,$02,$F8
	db $F4,$E7,$06,$02

DATA_00A9C2:
	db $08,$EE,$E0,$02,$00,$08,$FE,$E7,$06,$02,$FC,$02,$E3,$06,$02,$04
	db $F6,$E5,$06,$02

DATA_00A9D6:
	db $08,$EC,$E0,$02,$00,$08,$E4,$E0,$02,$00,$FC,$00,$E5,$06,$02,$04
	db $F4,$E7,$06,$02

DATA_00A9EA:
	db $08,$F6,$E0,$02,$00,$08,$EE,$E0,$02,$00,$08,$E6,$E0,$02,$00,$FC
	db $FE,$E7,$06,$02

UNK_00A9FE:
	db $00,$10,$E0,$02,$00,$00,$08,$E0,$02,$00,$00,$00,$E0,$02,$00,$00
	db $F8,$E0,$02,$00

DATA_00AA12:
	db $FF,$02,$60,$C3,$02,$FF,$F2,$60,$43,$02,$EF,$02,$60,$83,$02,$EF
	db $F2,$60,$03,$02

DATA_00AA26:
	db $0B,$FF,$60,$C3,$02,$FB,$FF,$60,$83,$02,$0B,$EF,$60,$43,$02,$FB
	db $EF,$60,$03,$02

DATA_00AA3A:
	db $11,$08,$60,$C3,$02,$11,$F8,$60,$43,$02,$01,$08,$60,$83,$02,$01
	db $F8,$60,$03,$02

DATA_00AA4E:
	db $0B,$11,$60,$C3,$02,$FB,$11,$60,$83,$02,$0B,$01,$60,$43,$02,$FB
	db $01,$60,$03,$02

DATA_00AA62:
	db $FF,$0E,$60,$C3,$02,$EF,$0E,$60,$83,$02,$FF,$FE,$60,$43,$02,$EF
	db $FE,$60,$03,$02

DATA_00AA76:
	db $08,$08,$60,$C3,$02,$F8,$08,$60,$83,$02,$08,$F8,$60,$43,$02,$F8
	db $F8,$60,$03,$02

DATA_00AA8A:
	db $06,$03,$63,$07,$02,$FD,$06,$63,$07,$02,$03,$FD,$63,$07,$02,$FA
	db $FA,$63,$07,$02

DATA_00AA9E:
	db $06,$01,$63,$07,$02,$FD,$04,$63,$07,$02,$03,$FB,$63,$07,$02,$FA
	db $F8,$65,$07,$02

DATA_00AAB2:
	db $06,$00,$65,$07,$02,$FD,$03,$63,$07,$02,$03,$FA,$63,$07,$02,$FA
	db $F7,$67,$07,$02

DATA_00AAC6:
	db $08,$F0,$E0,$02,$00,$06,$FE,$67,$07,$02,$FD,$01,$63,$07,$02,$03
	db $F8,$65,$07,$02

DATA_00AADA:
	db $08,$E7,$E0,$02,$00,$08,$EF,$E0,$02,$00,$FD,$00,$65,$07,$02,$03
	db $F7,$67,$07,$02

DATA_00AAEE:
	db $08,$E5,$E0,$02,$00,$08,$ED,$E0,$02,$00,$08,$F5,$E0,$02,$00,$FD
	db $FD,$67,$07,$02

UNK_00AB02:
	db $00,$10,$E0,$02,$00,$00,$08,$E0,$02,$00,$00,$00,$E0,$02,$00,$00
	db $F8,$E0,$02,$00

DATA_00AB16:
	db $02,$04,$72,$C3,$00,$02,$FC,$72,$43,$00,$FA,$04,$72,$83,$00,$FA
	db $FC,$72,$03,$00

DATA_00AB2A:
	db $0A,$02,$72,$C3,$00,$02,$02,$72,$83,$00,$0A,$FA,$72,$43,$00,$02
	db $FA,$72,$03,$00

DATA_00AB3E:
	db $0E,$08,$72,$C3,$00,$0E,$00,$72,$43,$00,$06,$08,$72,$83,$00,$06
	db $00,$72,$03,$00

DATA_00AB52:
	db $0A,$0E,$72,$C3,$00,$02,$0E,$72,$83,$00,$0A,$06,$72,$43,$00,$02
	db $06,$72,$03,$00

DATA_00AB66:
	db $02,$0C,$72,$C3,$00,$FA,$0C,$72,$83,$00,$02,$04,$72,$43,$00,$FA
	db $04,$72,$03,$00

DATA_00AB7A:
	db $08,$08,$72,$C3,$00,$00,$08,$72,$83,$00,$08,$00,$72,$43,$00,$00
	db $00,$72,$03,$00

DATA_00AB8E:
	db $00,$00,$69,$07,$00,$06,$02,$69,$07,$00,$08,$06,$69,$07,$00,$02
	db $08,$69,$07,$00

DATA_00ABA2:
	db $00,$FF,$6A,$07,$00,$06,$01,$69,$07,$00,$08,$05,$69,$07,$00,$02
	db $07,$69,$07,$00

DATA_00ABB6:
	db $00,$FE,$6B,$07,$00,$06,$00,$69,$07,$00,$08,$04,$6A,$07,$00,$02
	db $06,$69,$07,$00

DATA_00ABCA:
	db $08,$F7,$E0,$02,$00,$06,$FF,$6A,$07,$00,$08,$03,$6B,$07,$00,$02
	db $05,$69,$07,$00

DATA_00ABDE:
	db $08,$EE,$E0,$02,$00,$08,$F6,$E0,$02,$00,$06,$FE,$6B,$07,$00,$02
	db $04,$6A,$07,$00

DATA_00ABF2:
	db $08,$E5,$E0,$02,$00,$08,$ED,$E0,$02,$00,$08,$FB,$E0,$02,$00,$02
	db $03,$6B,$07,$00

UNK_00AC06:
	db $00,$10,$E0,$02,$00,$00,$08,$E0,$02,$00,$00,$00,$E0,$02,$00,$00
	db $F8,$E0,$02,$00

DATA_00AC1A:
	db $05,$06,$62,$C3,$00,$05,$FE,$62,$43,$00,$FD,$06,$62,$83,$00,$FD
	db $FE,$62,$03,$00

DATA_00AC2E:
	db $0B,$FD,$62,$43,$00,$0B,$05,$62,$C3,$00,$03,$05,$62,$83,$00,$03
	db $FD,$62,$03,$00

DATA_00AC42:
	db $0B,$00,$62,$43,$00,$0B,$08,$62,$C3,$00,$03,$08,$62,$83,$00,$03
	db $00,$62,$03,$00

DATA_00AC56:
	db $03,$0B,$62,$83,$00,$0B,$03,$62,$43,$00,$0B,$0B,$62,$C3,$00,$03
	db $03,$62,$03,$00

DATA_00AC6A:
	db $04,$0A,$62,$C3,$00,$04,$02,$62,$43,$00,$FC,$0A,$62,$83,$00,$FC
	db $02,$62,$03,$00

DATA_00AC7E:
	db $08,$00,$62,$43,$00,$08,$08,$62,$C3,$00,$00,$08,$62,$83,$00,$00
	db $00,$62,$03,$00

DATA_00AC92:
	db $05,$03,$79,$07,$00,$06,$05,$79,$07,$00,$03,$06,$79,$07,$00,$02
	db $02,$79,$07,$00

DATA_00ACA6:
	db $05,$02,$79,$07,$00,$06,$04,$79,$07,$00,$03,$05,$79,$07,$00,$02
	db $01,$7A,$07,$00

DATA_00ACBA:
	db $05,$02,$79,$07,$00,$06,$04,$7A,$07,$00,$03,$05,$79,$07,$00,$02
	db $01,$7B,$07,$00

DATA_00ACCE:
	db $08,$F9,$E0,$02,$00,$05,$01,$7A,$07,$00,$06,$03,$7B,$07,$00,$03
	db $04,$79,$07,$00

DATA_00ACE2:
	db $08,$F1,$E0,$02,$00,$08,$F9,$E0,$02,$00,$05,$01,$7B,$07,$00,$03
	db $04,$7A,$07,$00

DATA_00ACF6:
	db $08,$EB,$E0,$02,$00,$08,$F3,$E0,$02,$00,$08,$FB,$E0,$02,$00,$03
	db $03,$7B,$07,$00

;---------------------------------------------------------------------------

CODE_00AD0A:
CODE_ambient_oam_shrink_flush:                     ; ambient sprite handler (entry $25 in DATA_ambient_sprite_routines): shrink the slot's 8-tile OAM cluster inward by per-frame factor $7E4C, then fall through to the standard freeze + slot-lifetime checks
	LDA.w !EXRAM_YI_Level_AmbSpr_OAMIndex|!EXRAMBankMirror,x
	BMI.b CODE_00AD61
	REP.b #$10
	TAY
	LDA.w $7E4C,x
	STA.b $00
	LDA.w $6000,y
	SEC
	SBC.b $00
	STA.w $6000,y
	LDA.w $6002,y
	SEC
	SBC.b $00
	STA.w $6002,y
	LDA.w $6008,y
	CLC
	ADC.b $00
	STA.w $6008,y
	LDA.w $600A,y
	SEC
	SBC.b $00
	STA.w $600A,y
	LDA.w $6010,y
	SEC
	SBC.b $00
	STA.w $6010,y
	LDA.w $6012,y
	CLC
	ADC.b $00
	STA.w $6012,y
	LDA.w $6018,y
	CLC
	ADC.b $00
	STA.w $6018,y
	LDA.w $601A,y
	CLC
	ADC.b $00
	STA.w $601A,y
	SEP.b #$10
CODE_00AD61:
	JSR.w CODE_check_ambient_sprite_freeze
	LDA.w $7782,x
	BNE.b CODE_00AD6C
	JMP.w CODE_008AF8

CODE_00AD6C:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; DATA_scene_gfx_layout -- per-scene compressed-graphics chunk list.
; Raidenthequick: DATA_scene_gfx_layout.
; Variable-length stream consumed by CODE_load_compressed_gfx_files.
;
; Entry format (3 bytes after the first byte):
;   byte 0 = chunk-index:
;     $00..$EF -- literal compressed-file index
;     $F0..$F8 -- (byte0 - $F0) is an index into DP $10..$1C (set up by
;                  CODE_load_level_gfx). The DP value at that offset is the real
;                  file index (per-level tilesets/spritesets).
;     $FF      -- end-of-section terminator (no following bytes)
;   bytes 1-2 = VRAM destination address (word, LE). High bit set =>
;     decompress as LZ16 with extra 2-byte uncompressed-size header in the
;     DATA_scene_gfx_layout stream itself (CODE_decompress_gfx_file path);
;     otherwise => LZ2 (LC_LZ2) decompression. (Cart asm + framework label
;     this format "lz1"; verified 2026-05-26 it's LC_LZ2 — see Bank08.asm
;     header on CODE_lz2_decompress.)
;
; Indexed by a Y offset that varies per scene (each scene starts at a
; specific Y -- e.g. CODE_00B3E6 uses Y=$004F for the title-screen scene).
;-------------------------------------------------------------------------
DATA_00AD6D:
DATA_scene_gfx_layout:                             ; Raidenthequick: DATA_scene_gfx_layout
	db $19,$00,$F8,$00,$10,$12,$00,$92,$00,$04,$76,$00,$95,$00,$06,$72
	db $00,$C0,$00,$20,$4F,$00,$60,$F3,$00,$98,$00,$10,$F4,$00,$A0,$00
	db $10,$F0,$00,$00,$F1,$00,$08,$F2,$00,$70,$F7,$00,$D0,$00,$04,$F8
	db $00,$D2,$00,$04,$F9,$00,$D4,$00,$04,$FA,$00,$D6,$00,$04,$FB,$00
	db $D8,$00,$04,$FC,$00,$DA,$00,$04,$F5,$00,$28,$F6,$00,$2C,$FF,$F0
	db $00,$34,$1D,$00,$38,$73,$00,$DC,$00,$08,$73,$00,$FC,$00,$08,$74
	db $00,$BC,$00,$08,$B1,$00,$00,$FF,$72,$00,$C0,$00,$20,$FF,$10,$00
	db $C0,$00,$10,$11,$00,$C8,$00,$10,$FF,$27,$00,$78,$87,$00,$80,$00
	db $20,$88,$00,$90,$00,$20,$89,$00,$A0,$00,$20,$8B,$00,$B0,$00,$20
	db $8A,$00,$C0,$00,$20,$4A,$00,$50,$73,$00,$74,$74,$00,$60,$75,$00
	db $68,$FF,$F0,$00,$00,$F1,$00,$08,$7E,$00,$14,$F2,$00,$B8,$00,$08
	db $F3,$00,$BC,$00,$08,$56,$00,$10,$F4,$00,$30,$F5,$00,$C0,$00,$08
	db $F6,$00,$C4,$00,$08,$F7,$00,$C8,$00,$08,$F8,$00,$CC,$00,$08,$F9
	db $00,$D0,$00,$08,$FA,$00,$D4,$00,$08,$FB,$00,$D8,$00,$08,$FC,$00
	db $DC,$00,$08,$8F,$00,$E0,$00,$10,$8C,$00,$F0,$00,$10,$73,$00,$FC
	db $00,$08,$FF,$21,$00,$70,$22,$00,$74,$14,$00,$F8,$00,$10,$15,$00
	db $90,$00,$10,$16,$00,$98,$00,$10,$1C,$00,$28,$4E,$00,$2C,$72,$00
	db $C0,$00,$20,$13,$00,$D0,$00,$10,$F0,$00,$68,$F2,$00,$38,$F4,$00
	db $34,$FF,$41,$00,$70,$19,$00,$F8,$00,$10,$25,$00,$00,$26,$00,$08
	db $F0,$00,$98,$00,$10,$F1,$00,$A0,$00,$10,$50,$00,$28,$4E,$00,$2C
	db $72,$00,$C0,$00,$20,$24,$00,$50,$4E,$00,$D8,$00,$04,$F2,$00,$68
	db $F3,$00,$38,$FF,$F0,$00,$00,$F1,$00,$10,$F2,$00,$20,$F3,$00,$30
	db $F4,$00,$00,$72,$00,$C0,$00,$20,$4F,$00,$60,$F5,$00,$D0,$00,$04
	db $F6,$00,$D2,$00,$04,$F7,$00,$D4,$00,$04,$F8,$00,$D6,$00,$04,$F9
	db $00,$D8,$00,$04,$FA,$00,$DA,$00,$04,$FF,$1B,$00,$70,$1E,$00,$74
	db $1E,$00,$78,$72,$00,$C0,$00,$20,$4F,$00,$60,$AF,$00,$28,$AF,$00
	db $30,$AF,$00,$38,$67,$00,$D0,$00,$04,$3C,$00,$D2,$00,$04,$55,$00
	db $D4,$00,$04,$1A,$00,$D6,$00,$04,$1A,$00,$D8,$00,$04,$29,$00,$DA
	db $00,$04,$FF,$B3,$00,$D4,$00,$10,$AA,$00,$5C,$FF

;-------------------------------------------------------------------------
; DATA_bg1_tileset_files -- 16 rows of 3 bytes each.
; Raidenthequick: DATA_bg1_tileset_files.
; Indexed by !RAM_YI_Level_LevelHeaderBG1TilesetLo * 3 -- yields three
; compressed-file indexes that CODE_load_level_gfx stuffs into DP $10/$11/$12
; (consumed via DATA_scene_gfx_layout $F0/$F1/$F2 indirection).
;-------------------------------------------------------------------------
DATA_00AF39:
DATA_bg1_tileset_files:                            ; Raidenthequick: DATA_bg1_tileset_files
	db $00,$01,$40,$02,$03,$41,$08,$09,$44,$0A,$0B,$45,$04,$05,$42,$06
	db $07,$43,$0C,$0D,$46,$0E,$0F,$47,$30,$31,$40,$32,$33,$41,$38,$39
	db $46,$3A,$3B,$45,$34,$35,$42,$36,$37,$47,$3C,$3D,$46,$3E,$3F,$47

;-------------------------------------------------------------------------
; DATA_bg1_dark_tileset_files -- World-6 (Bowser) variant of
; DATA_bg1_tileset_files. Same shape: 16 rows of 3 bytes. CODE_load_level_gfx picks
; this table instead of the regular one when CurrentWorld == World6.
;-------------------------------------------------------------------------
DATA_00AF69:
DATA_bg1_dark_tileset_files:                       ; Raidenthequick: DATA_bg1_dark_tileset_files
	db $00,$01,$40,$69,$6A,$6B,$08,$09,$44,$0A,$0B,$45,$04,$05,$42,$06
	db $07,$43,$0C,$0D,$46,$0E,$0F,$47,$30,$31,$40,$32,$33,$41,$38,$39
	db $46,$3A,$3B,$45,$34,$35,$42,$36,$37,$47,$3C,$3D,$46,$3E,$3F,$47

;-------------------------------------------------------------------------
; DATA_bg2_tileset_files -- 32 entries (words), indexed by
; LevelHeaderBG2Tileset * 2. Yields two compressed-file indexes packed
; LE into the word (stored at DP $13/$14).
;-------------------------------------------------------------------------
DATA_00AF99:
DATA_bg2_tileset_files:                            ; Raidenthequick: DATA_bg2_tileset_files
	dw $1817,$A308,$0302,$0100,$0100,$7E77,$900C,$0B0A
	dw $0706,$7877,$0E79,$7A04,$7C7B,$A47D,$7E7F,$8281
	dw $7877,$0500,$0500,$8483,$8180,$8685,$A2A1,$0908
	dw $7E0D,$900E,$8685,$8685,$0909,$A6A5,$7B7A,$A8A7

;-------------------------------------------------------------------------
; DATA_bg3_tilesets_files -- 48 entries, indexed by
; LevelHeaderBG3Tileset * 2. Word per entry, stored at DP $15/$16.
;-------------------------------------------------------------------------
DATA_00AFD9:
DATA_bg3_tilesets_files:                           ; Raidenthequick: DATA_bg3_tilesets_files
	dw $4E4D,$1514,$1516,$1818,$5251,$1516,$1516,$1516
	dw $1516,$1313,$4E12,$1516,$111A,$1110,$2928,$2B2A
	dw $4E4D,$6310,$1715,$4E4E,$5251,$5253,$5C5B,$5454
	dw $541B,$5251,$5251,$1718,$1414,$4E4E,$1919,$4E4D
	dw $1861,$5251,$4E62,$6319,$4E64,$6565,$1766,$5267
	dw $6262,$5857,$1919,$5857,$6268,$6268,$5857,$5859

;-------------------------------------------------------------------------
; DATA_spriteset_files -- per-spriteset rows of 6 bytes
; (3 file indexes, each as word). Indexed by
; LevelHeaderSpriteTileset * 6. The first 3 words are mirrored to
; both $6EB6/$6EB8/$6EBA (persistent VRAM-mapping cache) and DP $17/$19/$1B
; (used by CODE_load_compressed_gfx_files via the $F4/$F5/$F6 indirections).
;-------------------------------------------------------------------------
DATA_00B039:
DATA_spriteset_files:                              ; Raidenthequick: DATA_spriteset_files
	dw $2120,$2B2A,$295E,$2120,$1C5E,$2931,$2C1F,$4036
	dw $2951,$5E2E,$1A37,$1F1A,$5E55,$1F5F,$291A,$4053
	dw $1A51,$291A,$2A36,$3C2B,$712D,$364A,$711C,$5931
	dw $1A6A,$1A1A,$1A1A,$7150,$312F,$2949,$5755,$715D
	dw $2F1C,$7155,$573C,$1C4A,$3F3C,$711F,$1A1A,$7125
	dw $1A1C,$1A1A,$1A2E,$1A1A,$1F1A,$5736,$1C38,$295C
	dw $3B3A,$5531,$2971,$6160,$221C,$2523,$251C,$4342
	dw $294F,$5B5A,$255C,$296A,$371F,$4239,$1A43,$3527
	dw $3D4E,$301A,$1C4E,$4651,$2971,$2322,$6045,$301A
	dw $4342,$3938,$591C,$1D60,$4E71,$301C,$1D60,$4640
	dw $304E,$1D55,$4E60,$1A51,$6336,$5C1F,$291A,$1D39
	dw $1B35,$3063,$1A71,$5F51,$3060,$632A,$1A1A,$1A1A
	dw $3E27,$3D1A,$1A1A,$2B25,$6447,$1F36,$6151,$6548
	dw $601C,$1C48,$2865,$7160,$451C,$711F,$296A,$6A4D
	dw $1F48,$291A,$6028,$4E38,$5136,$1A1A,$1A2D,$1A1A
	dw $3545,$6454,$1C1F,$5854,$3D35,$6471,$4135,$641F
	dw $1C5C,$3332,$4134,$544C,$1E64,$1F41,$291C,$1E55
	dw $6028,$5C71,$4C64,$4041,$2968,$5C2F,$1C5D,$1A1A
	dw $6527,$AA49,$1F1C,$4861,$1C71,$6A55,$3C71,$3F60
	dw $AA49,$1A53,$551C,$5931,$4342,$1F55,$1A41,$2B2A
	dw $7129,$5D1C,$1F55,$2A27,$291A,$2B4F,$5247,$5160
	dw $472B,$7138,$5160,$2940,$4E31,$591C,$1A1C,$4E1A
	dw $1A1A,$472B,$5226,$2956,$472B,$5226,$2931,$472B
	dw $291F,$5131,$472B,$1E2F,$2971,$1A29,$531A,$1F1B
	dw $4031,$1A1F,$1A1A,$3541,$7139,$291F,$472B,$4924
	dw $1F1A,$5C1F,$4E49,$475D,$3B3A,$1A1C,$291A,$1A1F
	dw $1A38,$1A1A,$472B,$5437,$2971,$3C3F,$1C66,$6047
	dw $3531,$5471,$1F55,$1F2E,$2449,$295E,$5458,$1F5E
	dw $2948,$6560,$7130,$1A1A,$295E,$2671,$4B49,$2F55
	dw $6458,$592C,$245E,$291C,$4B49,$2527,$4938,$292A
	dw $361F,$1A4E,$1A1A,$1F4D,$2855,$7160,$712E,$1A1C
	dw $1A1A,$3935,$2541,$2964,$2564,$4136,$291A,$444E
	dw $3D1A,$2948,$1E5D,$3D36,$4825,$4342,$6A44,$1A1A
	dw $4564,$1A1A,$291F,$2B2A,$6A38,$5E6C,$3155,$1A1A
	dw $1F1A,$3E35,$3D1C,$472B,$2B2A,$635E,$1A1A,$1A24
	dw $1A1A,$1A1A,$361A,$2931,$5966,$3A40,$373B,$1A36
	dw $702F,$6A61,$1F1A,$6C6B,$6A1A,$1F47,$5C57,$245D
	dw $291C,$711B,$1C29,$5D1F,$5C55,$455F,$3771,$6D6F
	dw $296E,$1A6A,$6A55,$1AA9,$1F1A,$3C62,$534E,$4471
	dw $6A68,$1A1A,$1A1A,$1E1A,$1F52,$2971,$445D,$564C
	dw $1A1A,$291C,$2A44,$4E71,$7145,$581C,$1A1A,$2555
	dw $1F71,$1C29,$375D,$2971,$1A1C,$6A45,$1A1F,$1A1A
	dw $641F,$5341,$1C3E,$7153,$1C5D,$1A1A,$1C36,$2838
	dw $2960,$472B,$2120,$711C,$2120,$1C2F,$475D,$3527
	dw $5441,$6864,$711C,$2D2C,$1A1A,$6C6A,$1A63,$1A1A
	dw $2322,$6045,$301A,$3C67,$1A55,$291A,$7154,$4C41
	dw $3764,$AEAD,$B0AF,$6A67,$4755,$4957,$291C,$2B27
	dw $1C47,$2925,$7127,$311C,$1A1A,$451C,$711F,$2946

;-------------------------------------------------------------------------
; CODE_load_level_gfx -- master entry for level/scene graphics
; load. Reads the level's BG1/BG2/BG3/sprite tileset header fields,
; resolves each via the per-set file-index tables (DATA_bg1_tileset_files etc),
; caches the resolved file indexes into DP $10-$1C, then falls through
; to CODE_load_compressed_gfx_files with Y=0 (start of the in-level scene's
; chunk list in DATA_scene_gfx_layout).
; Raidenthequick: CODE_load_level_gfx.
; Deep dive: docs/enginecore.md section 6 (full LZ dispatch pipeline).
;
; INPUTS:   !RAM_YI_Level_LevelHeaderBG1TilesetLo/BG2/BG3/SpriteTileset;
;           !RAM_YI_Level_CurrentWorldLo (switches BG1 to dark tables for
;           World 6); SCBR ($012D) and SCMR ($012E) already set by
;           CODE_init_scene_regs.
; OUTPUTS:  All compressed graphics blobs DMA'd into VRAM via SuperFX
;           LZ2 (and LZ16, in scenes that use it) decompression;
;           $6EB6/$6EB8/$6EBA cache the spriteset file IDs for later
;           sprite VRAM updates.
; MODIFIES: DBR pushed (set to $00); A, X, Y; DP $10..$1C; SuperFX
;           regs; $012D/$012E (reset to default scene values $16/screen-mode).
; CALLERS:  level-load chain in Bank01 (game-mode $0E init); various scene
;           loaders (Bank0F overworld init, Bank10 boot-screen init,
;           Bank17 cutscene init) reach this via direct CODE_load_level_gfx JSL
;           or the CODE_load_compressed_gfx_files_l trampoline (CODE_load_compressed_gfx_files_l)
;           for Y != 0 starting offsets.
;
; Sub-entry CODE_load_overworld_gfx: world-map intro-graphics loader. Patches DP $10
; to a special "world-map BG1 placeholder" then jumps to
; CODE_load_compressed_gfx_files with Y=$004F to start at the world-map scene
; entry in DATA_scene_gfx_layout.
;-------------------------------------------------------------------------
CODE_00B339:
CODE_load_level_gfx:                               ; Raidenthequick: CODE_load_level_gfx
	PHB
	PHK
	PLB
	REP.b #$30
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	ASL
	ADC.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	TAY
	LDA.w !RAM_YI_Level_CurrentWorldLo
	CMP.w #!Define_YI_WorldID_World6
	BNE.b CODE_00B35A
	LDA.w DATA_bg1_dark_tileset_files,y
	STA.b $10
	LDA.w DATA_bg1_dark_tileset_files+$01,y
	STA.b $11
	BRA.b CODE_00B364

CODE_00B35A:
	LDA.w DATA_bg1_tileset_files,y
	STA.b $10
	LDA.w DATA_bg1_tileset_files+$01,y
	STA.b $11
CODE_00B364:
	LDA.w !RAM_YI_Level_LevelHeaderBG2TilesetLo
	ASL
	TAY
	LDA.w DATA_bg2_tileset_files,y
	STA.b $13
	LDA.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	ASL
	TAY
	LDA.w DATA_bg3_tilesets_files,y
	STA.b $15
	LDA.w !RAM_YI_Level_LevelHeaderSpriteTilesetLo
	ASL
	ADC.w !RAM_YI_Level_LevelHeaderSpriteTilesetLo
	ASL
	TAY
	LDA.w DATA_spriteset_files,y
	STA.w $6EB6
	STA.b $17
	LDA.w DATA_spriteset_files+$02,y
	STA.w $6EB8
	STA.b $19
	LDA.w DATA_spriteset_files+$04,y
	STA.w $6EBA
	STA.b $1B
	SEP.b #$20
	LDY.w #$0000
;-------------------------------------------------------------------------
; CODE_load_compressed_gfx_files -- inner loop of the gfx pipeline.
; Walks DATA_scene_gfx_layout starting at Y, calling CODE_decompress_gfx_file
; (CODE_decompress_gfx_file) for each entry until terminator $FF is hit.
; Raidenthequick: CODE_load_compressed_gfx_files.
;
; INPUTS:   Y = byte offset into DATA_scene_gfx_layout (start-of-scene index);
;           DP $10-$1C populated by CODE_load_level_gfx with per-set file ids.
; OUTPUTS:  Each chunk's compressed graphics decompressed via SuperFX
;           (LZ2 or LZ16, format selected by VRAM dest high bit) and DMA'd
;           into VRAM at the per-entry destination.
; MODIFIES: A, X, Y (Y at end is past terminator); $012D/$012E pre-loaded
;           to default SCBR=$16 / scene-mode screen-mode flags.
; CALLERS:  CODE_load_level_gfx (falls through with Y=0); CODE_load_overworld_gfx (world-map
;           BG1, Y=$4F); CODE_load_world_map_gfx (world-map gfx, Y=$A2); CODE_load_per_world_variant_gfx
;           (per-world variant chain, Y=$122); CODE_load_levelmode_0A_gfx
;           (CODE_00B4D3, Y=$18A); CODE_load_compressed_gfx_files_l
;           = JML-callable trampoline.
;-------------------------------------------------------------------------
CODE_00B39E:
CODE_load_compressed_gfx_files:                    ; Raidenthequick: CODE_load_compressed_gfx_files
	LDA.b #$16
	STA.w $012D
	LDA.b #!SuperFX_ScreenMode_ScreenHeight_160pixels|!SuperFX_ScreenMode_ColorMode_16Colors|!SuperFX_ScreenMode_SuperFXHasWRAMAccess|!SuperFX_ScreenMode_SuperFXHasROMAccess|!SuperFX_ScreenMode_ColorMode_Unused
	STA.w $012E
CODE_00B3A8:
	LDA.w DATA_scene_gfx_layout,y
	CMP.b #$F0
	BCC.b CODE_00B3C0
	CMP.b #$FF
	BEQ.b CODE_00B3CB
	SEC
	SBC.b #$F0
	REP.b #$20
	AND.w #$00FF
	TAX
	SEP.b #$20
	LDA.b $10,x
CODE_00B3C0:
	LDX.w DATA_scene_gfx_layout+$01,y
	JSR.w CODE_decompress_gfx_file
	INY
	INY
	INY
	BRA.b CODE_00B3A8

CODE_00B3CB:
	SEP.b #$10
	PLB
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_load_overworld_gfx -- gfx-loader specialisation for the
; world-map overworld scene. Patches DP $10 to ID $68 (or $1F for the
; final-world-unlocked variant) then runs CODE_load_compressed_gfx_files with
; Y=$4F (start of overworld scene's chunk list).
; Raidenthequick: no descriptive label.
;
; INPUTS:   $011A (last-world flag); !RAM_YI_Level_FinalWorldUnlockedFlagLo.
; OUTPUTS:  overworld BG/sprite graphics loaded into VRAM.
; CALLERS:  game-mode $20 (prepare_overworld) handler in Bank10.
;-------------------------------------------------------------------------
CODE_00B3CF:
CODE_load_overworld_gfx:
	PHB
	PHK
	PLB
	LDA.b #$68
	STA.b $10
	LDA.w $011A
	CMP.b #$80
	BEQ.b CODE_00B3E6
	LDA.w !RAM_YI_Level_FinalWorldUnlockedFlagLo
	BNE.b CODE_00B3E6
	LDA.b #$1F
	STA.b $10
CODE_00B3E6:
	REP.b #$10
	LDY.w #$004F
	JMP.w CODE_load_compressed_gfx_files

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_load_compressed_gfx_files_l -- JSL/JML-callable bank-safe
; wrapper around CODE_load_compressed_gfx_files. Set Y to scene start offset
; before calling.
;-------------------------------------------------------------------------
CODE_00B3EE:
CODE_load_compressed_gfx_files_l:                  ; Raidenthequick: CODE_load_compressed_gfx_files_l
	PHB
	PHK
	PLB
	JMP.w CODE_load_compressed_gfx_files

;---------------------------------------------------------------------------

DATA_00B3F4:
	db $7C,$7D,$7F,$80,$81,$82,$83,$84,$85,$86,$87,$88,$74,$B5,$B7,$75
	db $B6,$B8,$4C,$6C,$6D

DATA_00B409:
	db $99,$9A,$9B,$9C,$9D,$9E,$9F,$A0
	db $99,$9A,$9B,$9C,$9D,$9E,$9F,$A0
	db $99,$9A,$9B,$9C,$9D,$9E,$9F,$A0
	db $99,$9A,$9B,$9C,$9D,$9E,$9F,$A0
	db $99,$9A,$9B,$9C,$9D,$9E,$9F,$A0
	db $99,$9A,$9B,$9C,$95,$96,$97,$98

;-------------------------------------------------------------------------
; CODE_load_world_map_gfx -- gfx-loader specialisation for the
; world-map overworld tilemap + per-world background graphics. Sets up
; DP $10..$17 from bg1_bg2_world_map_tilemaps (DATA_00B3F4) + world_map_gfx
; (DATA_00B409), then runs CODE_load_compressed_gfx_files at Y=$A2.
; Raidenthequick: no descriptive label.
;-------------------------------------------------------------------------
CODE_00B439:
CODE_load_world_map_gfx:
	PHB
	PHK
	PLB
	LDA.b #$74
	STA.b $12
	LDA.b #$75
	STA.b $13
	LDA.b #$4C
	STA.b $14
	LDY.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_00B3F4,y
	STA.b $10
	LDA.w DATA_00B3F4+$01,y
	STA.b $11
	TYA
	ASL
	ASL
	TAY
	LDX.b #$00
CODE_00B45B:
	LDA.w DATA_00B409,y
	STA.b $15,x
	INY
	INX
	CPX.b #$08
	BCC.b CODE_00B45B
	REP.b #$10
	LDY.w #$00A2
	JMP.w CODE_load_compressed_gfx_files

;---------------------------------------------------------------------------

DATA_00B46E:
	db $04,$04,$04,$79,$04,$04,$04,$77,$04,$0C,$0C,$04

DATA_00B47A:
	db $04,$04,$04,$7A,$04,$04,$04,$78,$05,$04,$04,$04

DATA_00B486:
	db $96,$96,$96,$96,$97,$98,$98,$9A,$9B,$99,$99,$96

DATA_00B492:
	db $9C,$9C,$9C,$9F,$9C,$9C,$9C,$A0,$A1,$9C,$9C,$9C

;-------------------------------------------------------------------------
; CODE_load_per_world_variant_gfx -- gfx-loader for per-world
; world-end / fortress variant scenes. Y selects one of 12 entries in
; the DATA_00B46E/$B47A/$B486/$B492 quadruple of byte arrays, then runs
; CODE_load_compressed_gfx_files at Y=$122.
;-------------------------------------------------------------------------
CODE_00B49E:
CODE_load_per_world_variant_gfx:
	PHB
	PHK
	PLB
	LDA.w DATA_00B46E,y
	STA.b $10
	LDA.w DATA_00B47A,y
	STA.b $11
	LDA.w DATA_00B486,y
	STA.b $12
	LDA.w DATA_00B492,y
	STA.b $13
	LDA.b #$4E
	STA.w $6EBA
	LDA.b #$FF
	STA.w $6EB6
	STA.w $6EB7
	STA.w $6EB8
	STA.w $6EB9
	STA.w $6EBB
	REP.b #$10
	LDY.w #$0122
	JMP.w CODE_load_compressed_gfx_files

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_load_levelmode_0A_gfx (CODE_00B4D3) -- hardcoded gfx loader for level-mode
; $0A (the 6-8 Kamek auto-scroll level). Sets X=$18 (scene index for
; CODE_init_scene_regs), bumps BG4SC, hardcodes the 6 sprite-set file ids
; into $6EB6..$6EBB, then runs CODE_load_compressed_gfx_files at Y=$18A.
; Raidenthequick: CODE_load_levelmode_0A_gfx.
;-------------------------------------------------------------------------
CODE_00B4D3:
CODE_load_levelmode_0A_gfx:                        ; Raidenthequick: CODE_load_levelmode_0A_gfx
	PHB
	PHK
	PLB
	LDX.b #$18
	JSL.l CODE_init_scene_regs
	LDA.b #$38
	STA.w !REGISTER_BG4AddressAndSize
	LDA.b #$67
	STA.w $6EB6
	LDA.b #$3C
	STA.w $6EB7
	LDA.b #$55
	STA.w $6EB8
	LDA.b #$1A
	STA.w $6EB9
	LDA.b #$1A
	STA.w $6EBA
	LDA.b #$29
	STA.w $6EBB
	REP.b #$10
	LDY.w #$018A
	JMP.w CODE_load_compressed_gfx_files

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_decompress_gfx_file (CODE_00B509) -- decompress one
; compressed graphics file and DMA the result into VRAM.
; Raidenthequick: CODE_decompress_gfx_file.
;
; Format dispatch (per DATA_scene_gfx_layout VRAM-dest high bit):
;   * bit 15 SET  -> LZ16 path via SuperFX FXCODE_0A8000. Pulls a 16-bit
;     uncompressed-size word from the byte AFTER the 3-byte entry in
;     DATA_scene_gfx_layout (Y is incremented +2 to swallow it). Sets up SuperFX
;     R0/R1/R3.
;   * bit 15 CLEAR -> LZ2 path via SuperFX FXCODE_08A980. Sets R9/R4/R10
;     (dest = SRAM $70:5800), runs decompressor; result size = R10 - $5800.
; In either case the decompressed bytes are then DMA'd from SRAM into VRAM
; at the destination given by the DATA_scene_gfx_layout entry (CODE_00B582).
;
; INPUTS:   A = compressed-file index (low byte); X = VRAM destination
;           address (word, with bit 15 acting as format flag); Y points
;           into DATA_scene_gfx_layout for LZ16 size lookup.
; OUTPUTS:  VRAM region at dest filled with decompressed graphics.
; MODIFIES: A, X, Y; DP $0A-$0F (size + scratch); SRAM $70:5800 (LZ2
;           staging buffer); SuperFX regs R0..R10; VRAM via DMA.
; CALLERS:  CODE_load_compressed_gfx_files (CODE_00B3A8) only.
;-------------------------------------------------------------------------
CODE_00B507:
CODE_decompress_gfx_file:                          ; Raidenthequick: CODE_decompress_gfx_file
	STX.b $0E
CODE_00B509:
	REP.b #$20
	AND.w #$00FF
	STA.b $0C
	ASL
	ADC.b $0C
	TAX
	LDA.b $0E
	BPL.b CODE_decompress_lc_lz2
	LDA.w DATA_scene_gfx_layout+$03,y
	STA.b $0A
	INY
	INY
	PHY
	ASL
	ASL
	XBA
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.l DATA_06FC79,x
	STA.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDA.l DATA_06FC79+$02,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	SEP.b #$10
	LDX.b #FXCODE_0A8000>>16
	LDA.w #FXCODE_0A8000
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDY.b $0A
	SEP.b #$20
	BRA.b CODE_00B582

; CODE_decompress_lc_lz2 -- LZ2 path of CODE_decompress_gfx_file (BPL target when
; VRAM dest high bit is clear). Sets up SuperFX R9 (file address), R4
; (file bank), R10 (SRAM staging dest $70:5800), runs FXCODE_08A980,
; then computes the decompressed size from R10's final value.
; (Raidenthequick names this `decompress_lc_lz1` after the misnamed cart
; convention; we use `lc_lz2` because the actual format is LC_LZ2.)
CODE_00B54D:
CODE_decompress_lc_lz2:                            ; was Raidenthequick: CODE_decompress_lc_lz1
	PHY
	LDA.l DATA_06F95E,x
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.l DATA_06F95E+$02,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	LDA.w #$705800
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	SEP.b #$10
	LDX.b #FXCODE_08A980>>16
	LDA.w #FXCODE_08A980
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	SEC
	SBC.w #$705800
	TAY
	SEP.b #$20
	LDA.b $0C
	CMP.b #$B1
	BCS.b CODE_00B5A7
CODE_00B582:
	LDA.b #$80
	STA.w !REGISTER_VRAMAddressIncrementValue
	LDX.b $0E
	STX.w !REGISTER_VRAMAddressLo
	LDX.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STX.w DMA[$00].Parameters
	LDX.w #$705800
	STX.w DMA[$00].SourceLo
	LDA.b #$705800>>16
	STA.w DMA[$00].SourceBank
	STY.w DMA[$00].SizeLo
	LDA.b #$01
	STA.w !REGISTER_DMAEnable
	PLY
	RTS

CODE_00B5A7:
	LDX.w #$0000
	CMP.b #$B9
	BEQ.b CODE_00B5C4
	CMP.b #$BA
	BEQ.b CODE_00B5C4
	INX
	INX
	CMP.b #$BB
	BEQ.b CODE_00B5C4
	CMP.b #$BC
	BEQ.b CODE_00B5C4
	INX
	INX
	CMP.b #$BD
	BEQ.b CODE_00B5C4
	INX
	INX
CODE_00B5C4:
	REP.b #$20
	TYA
	STA.b $00
	ASL
	PHA
	SEP.b #$20
	PHB
	LDA.b #$7E7BBE>>16
	PHA
	PLB
	REP.b #$20
	JSR.w (DATA_00B601,x)
	SEP.b #$20
	PLB
	PLY
	LDA.b $00
	BEQ.b CODE_00B5FF
	STA.w !REGISTER_VRAMAddressIncrementValue
	LDX.b $0E
	STX.w !REGISTER_VRAMAddressLo
	LDX.b $02
	STX.w DMA[$00].Parameters
	LDX.w #$7E7BBE
	STX.w DMA[$00].SourceLo
	LDA.b #$7E7BBE>>16
	STA.w DMA[$00].SourceBank
	STY.w DMA[$00].SizeLo
	LDA.b #$01
	STA.w !REGISTER_DMAEnable
CODE_00B5FF:
	PLY
	RTS

DATA_00B601:
	dw CODE_00B609
	dw CODE_00B6B7
	dw CODE_00B70B
	dw CODE_00B609

CODE_00B609:
	LDX.w #$0000
	LDY.w #$0000
CODE_00B60F:
	LDA.l !EXRAM_YI_Global_SuperFXGFXBuffer,x
	PHA
	AND.w #$000F
	STA.w $7E7BBE,y
	INY
	PLA
	AND.w #$00F0
	LSR
	LSR
	LSR
	LSR
	STA.w $7E7BBE,y
	INX
	INY
	DEC.b $00
	BNE.b CODE_00B60F
	LDA.w #$0080
	STA.b $00
	LDA.w #$1900
	STA.b $02
	RTS

DATA_00B637:
	db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$10,$10,$10,$10,$10,$10
	db $10,$20,$20,$20,$20,$20,$20,$30,$30,$30,$30,$30,$30,$30,$30,$30
	db $30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30
	db $30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30,$30

DATA_00B677:
	db $30,$30,$30,$30,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40
	db $40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40
	db $40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40
	db $40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40,$40

CODE_00B6B7:
	LDA.w #DATA_00B637>>16
	STA.b $04
	LDX.w #DATA_00B637
	LDA.b $0C
	CMP.w #$00BC
	BNE.b CODE_00B6C9
	LDX.w #DATA_00B677
CODE_00B6C9:
	STX.b $02
	LDX.w #$0000
	TXY
	LDA.w #$0020
	STA.b $06
CODE_00B6D4:
	LDA.l !EXRAM_YI_Global_SuperFXGFXBuffer,x
	AND.w #$00FF
	PHA
	AND.w #$000F
	ORA.b [$02]
	STA.w $7E7BBE,y
	INY
	PLA
	LSR
	LSR
	LSR
	LSR
	ORA.b [$02]
	STA.w $7E7BBE,y
	INY
	INX
	DEC.b $06
	BNE.b CODE_00B6FC
	LDA.w #$0020
	STA.b $06
	INC.b $02
CODE_00B6FC:
	DEC.b $00
	BNE.b CODE_00B6D4
	LDA.w #$0080
	STA.b $00
	LDA.w #$1900
	STA.b $02
	RTS

CODE_00B70B:
	PHB
	PHK
	PLB
	SEP.b #$10
	LDX.b #$00
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDX.b #$705800>>16
	STX.w DMA[$00].SourceBank
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$00
	STA.w DMA[$00].Parameters
	LDA.w #$705800
	STA.b $00
	LDX.b #$40
	LDY.b #$01
CODE_00B729:
	LDA.b $0E
	STA.w !REGISTER_VRAMAddressLo
	LDA.b $00
	STA.w DMA[$00].SourceLo
	LDA.w #$0040
	STA.w DMA[$00].SizeLo
	STY.w !REGISTER_DMAEnable
	LDA.b $0E
	CLC
	ADC.w #$0080
	STA.b $0E
	LDA.b $00
	CLC
	ADC.w #$0040
	STA.b $00
	DEX
	BNE.b CODE_00B729
	REP.b #$10
	PLB
	RTS

;---------------------------------------------------------------------------

CODE_00B753:
	LDX.w #$6800
CODE_00B756:
	STA.w $6000
	ASL
	ADC.w $6000
	STX.w $6000
	STX.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	TAX
	LDA.l DATA_06F95E,x
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.l DATA_06F95E+$02,x
	AND.w #$00FF
	STA.w !REGISTER_SuperFX_R4_LMULTResultLo
	SEP.b #$10
	LDX.b #FXCODE_08A980>>16
	LDA.w #FXCODE_08A980
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	REP.b #$10
	LDA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	SEC
	SBC.w $6000
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; DATA_scene_palette_layout -- per-table palette-load programs.
; Raidenthequick: DATA_scene_palette_layout.
;
; Walked by CODE_load_palettes starting at index X. Variable-length
; entries of 4 bytes each. Layout per entry:
;   word 0 = source pointer (relative to base $3FA000 = !DATA_master_palette_rom_blob):
;            * positive (< $8000): literal offset into the palette ROM blob
;            * negative bit set: AND $7FFF then INDIRECT through $0010,Y in DP
;              -- the index references the dynamic pointers set up by
;              CODE_load_level_palettes ($10/$12/$14/$16/$18/$1A/$1C) for the
;              level's BG1/BG2/BG3/sprite/Yoshi palette etc.
;            * $FFFF: end of program (return to caller)
;   byte 2 = CGRAM index (byte, word-addressed once ASL'd) -> destination row
;   byte 3 high nibble = number of CGRAM rows to fill
;   byte 3 low nibble  = colors per row (transfer size in words)
;
; CODE_load_palettes writes each color to BOTH !s_cgram_mirror (= CGRAM staging
; buffer the NMI later DMAs to PPU CGRAM) and $70:2D6C (second mirror used
; for fade/HDMA effects).
;
; Multiple table-start indices share this layout:
;   $0000 -> in-level palette load   (CODE_load_level_palettes default; 18 entries)
;   $0026 -> CODE_00BAEA (special)
;   $006E -> CODE_load_world_map_palettes (per-world world-map palette)
;   $00C2 -> CODE_load_yoshi_color_palette (Yoshi-color-only palette)
;   $00D8 -> CODE_load_levelmode_0A_palettes (CODE_00BB90)
;-------------------------------------------------------------------------
DATA_00B78A:
DATA_scene_palette_layout:                         ; Raidenthequick: DATA_scene_palette_layout
	dw $027C,$3B11,$01C8,$5F81,$8000,$1100,$8006,$1F01
	dw $8002,$2F41,$800A,$341C,$8004,$2F61,$8008,$2FE1
	dw $800C,$1FD1,$FFFF,$2860,$4F31,$28D8,$1F21,$2860
	dw $4FB1,$8000,$1100,$8002,$2F01,$8004,$1FF1,$FFFF
	dw $0130,$1100,$01C8,$1F81,$FFFF,$28F6,$2FE1,$FFFF
	dw $2DDC,$1100,$2DDC,$2F01,$30AC,$1F21,$328C,$1F31
	dw $2E18,$3F41,$346C,$1F81,$2ECC,$7F91,$FFFF,$8000
	dw $1100,$8002,$1F01,$8004,$1F11,$8006,$1F21,$8008
	dw $1F71,$2860,$4F31,$2860,$4F81,$3F4C,$2FC1,$3DC6
	dw $2FE1,$FFFF,$401A,$1100,$8000,$3F01,$8002,$1F71
	dw $01C8,$6F81,$8004,$4F31,$8006,$4F91,$3FFC,$1F51
	dw $3FFC,$1FB1,$8008,$1FD1,$01C8,$2FE1,$0222,$1FE1
	dw $FFFF,$2148,$1F01,$027C,$3B11,$4354,$4F41,$01C8
	dw $6F81,$8000,$1FD1,$FFFF,$586E,$8F01,$01C8,$5F81
	dw $8000,$1FD1,$8002,$2FE1,$FFFF

; DATA_bg1_palette_ptrs -- 32 entries, word per BG1 palette ID.
; Each entry = relative offset into the palette ROM blob ($3FA000-base).
; Indexed by LevelHeaderBG1Palette * 2 in CODE_load_level_palettes.
DATA_00B874:
DATA_bg1_palette_ptrs:                             ; Raidenthequick: DATA_bg1_palette_ptrs
	dw $067E,$06D2,$0726,$077A,$07CE,$0822,$0876,$08CA
	dw $091E,$0972,$09C6,$0A1A,$0A6E,$0AC2,$0B16,$0B6A
	dw $0BBE,$0C12,$0C66,$0CBA,$0D0E,$0D62,$0DB6,$0E0A
	dw $0E5E,$0EB2,$0F06,$0F5A,$0FAE,$1002,$1056,$10AA

; DATA_bg1_dark_world_palette_ptrs -- World-6 variant of
; DATA_bg1_palette_ptrs. CODE_load_level_palettes picks this table when
; CurrentWorld == World6.
DATA_00B8B4:
DATA_bg1_dark_world_palette_ptrs:                  ; Raidenthequick: DATA_bg1_dark_world_palette_ptrs
	dw $067E,$0BBE,$0726,$077A,$07CE,$0822,$0876,$08CA
	dw $091E,$0972,$09C6,$0A1A,$0A6E,$0AC2,$0B16,$0B6A
	dw $0BBE,$0C12,$0C66,$0CBA,$0D0E,$0D62,$0DB6,$0E0A
	dw $0E5E,$0EB2,$0F06,$0F5A,$0FAE,$1002,$1056,$10AA

; DATA_bg2_palette_ptrs -- 64 entries, indexed by
; LevelHeaderBG2Palette * 2.
DATA_00B8F4:
DATA_bg2_palette_ptrs:                             ; Raidenthequick: DATA_bg2_palette_ptrs
	dw $12A2,$11EE,$113A,$10FE,$11B2,$1176,$1266,$122A
	dw $12DE,$1356,$1392,$13CE,$140A,$1446,$1482,$14BE
	dw $1356,$10FE,$1176,$14FA,$1536,$1572,$1662,$1662
	dw $15AE,$15EA,$1626,$16DA,$169E,$1716,$1752,$178E
	dw $187E,$18BA,$18F6,$1932,$196E,$19AA,$19E6,$1A22
	dw $1A5E,$1A9A,$1AD6,$1B12,$1B4E,$1B8A,$1BC6,$1C02
	dw $1C3E,$1C7A,$1CB6,$1CF2,$1D2E,$1D6A,$1DA6,$1DE2
	dw $1E1E,$1E5A,$1E96,$1ED2,$1F0E,$1F4A,$1F86,$1FC2

; DATA_bg3_palette_ptrs -- 64 entries, indexed by
; LevelHeaderBG3Palette * 2.
DATA_00B974:
DATA_bg3_palette_ptrs:                             ; Raidenthequick: DATA_bg3_palette_ptrs
	dw $1FFE,$201C,$203A,$2058,$2076,$2094,$20B2,$20D0
	dw $2166,$210C,$212A,$2148,$20EE,$2184,$21A2,$21C0
	dw $21DE,$21FC,$221A,$2238,$2256,$2274,$2292,$22B0
	dw $22CE,$22EC,$230A,$2328,$2346,$2364,$2382,$23A0
	dw $23BE,$23DC,$23FA,$2418,$2436,$2454,$2472,$2490
	dw $24AE,$24CC,$24EA,$2508,$2526,$2544,$2562,$2580
	dw $259E,$25BC,$25DA,$25F8,$2616,$2634,$2652,$2670
	dw $268E,$26AC,$26CA,$26E8,$2706,$2724,$2742,$2760

; DATA_sprite_palette_ptrs -- 16 entries, indexed by
; LevelHeaderSpritePalette * 2.
DATA_00B9F4:
DATA_sprite_palette_ptrs:                          ; Raidenthequick: DATA_sprite_palette_ptrs
	dw $02BE,$02FA,$0336,$0372,$03AE,$03EA,$0426,$0462
	dw $049E,$04DA,$0516,$0552,$058E,$05CA,$0606,$0642

; DATA_yoshi_palette_ptrs -- 8 entries (1 per Yoshi color),
; indexed by CurrentYoshiColor * 2.
DATA_00BA14:
DATA_yoshi_palette_ptrs:                           ; Raidenthequick: DATA_yoshi_palette_ptrs
	dw $0040,$005E,$007C,$009A,$00B8,$00D6,$00F4,$0112

;-------------------------------------------------------------------------
; CODE_load_level_palettes -- top-level palette loader for an
; in-level scene. Resolves per-header palette pointers (BG1 / BG2 / BG3 /
; sprite / Yoshi), caches them at DP $10..$1C, then falls through to
; CODE_load_palettes with X=0 (start of in-level palette program).
; Raidenthequick: CODE_load_level_palettes.
; Deep dive: docs/enginecore.md section 5 (palette interpreter).
;
; INPUTS:   !RAM_YI_Level_LevelHeaderBackgroundColor (chooses one of 256
;           backdrop colors in the palette blob, at offset $130 + bg*2);
;           BG1/BG2/BG3/Sprite palette IDs from the level header;
;           CurrentYoshiColor (Yoshi-color palette); CurrentWorld
;           (selects DATA_bg1_dark_world_palette_ptrs for World 6).
; OUTPUTS:  DP $10..$1C populated with relative pointers; CGRAM mirror at
;           !s_cgram_mirror filled (NMI later DMAs to PPU CGRAM); $70:2D6C
;           secondary mirror also filled.
; MODIFIES: DBR pushed; A, X, Y; DP $00..$1C; M/X widths restored on exit.
; CALLERS:  level-load chain (game-mode $0E init in Bank01); world-map
;           reload after level completion.
;-------------------------------------------------------------------------
CODE_00BA24:
CODE_load_level_palettes:                          ; Raidenthequick: CODE_load_level_palettes
	PHB
	PHK
	PLB
	REP.b #$30
	LDA.w !RAM_YI_Level_LevelHeaderBackgroundColorLo
	ASL
	ADC.w #$0130
	STA.b $10
	LDA.w !RAM_YI_Level_LevelHeaderBG1PaletteLo
	ASL
	TAY
	LDA.w !RAM_YI_Level_CurrentWorldLo
	CMP.w #!Define_YI_WorldID_World6
	BNE.b CODE_00BA44
	LDA.w DATA_bg1_dark_world_palette_ptrs,y
	BRA.b CODE_00BA47

CODE_00BA44:
	LDA.w DATA_bg1_palette_ptrs,y
CODE_00BA47:
	STA.b $12
	CLC
	ADC.w #$003C
	STA.b $1A
	LDA.w !RAM_YI_Level_LevelHeaderBG2PaletteLo
	ASL
	TAY
	LDA.w DATA_bg2_palette_ptrs,y
	STA.b $14
	LDA.w !RAM_YI_Level_LevelHeaderBG3PaletteLo
	ASL
	TAY
	LDA.w DATA_bg3_palette_ptrs,y
	STA.b $16
	LDA.w !RAM_YI_Level_LevelHeaderSpritePaletteLo
	ASL
	TAY
	LDA.w DATA_sprite_palette_ptrs,y
	STA.b $18
	LDA.w !RAM_YI_Level_CurrentYoshiColorLo
	ASL
	TAY
	LDA.w DATA_yoshi_palette_ptrs,y
	STA.b $1C
	LDX.w #$0000
;-------------------------------------------------------------------------
; CODE_load_palettes -- engine palette interpreter. Reads
; DATA_scene_palette_layout entries starting at X, decodes source/CGRAM-dest/
; size/rows, and copies palette words from the global palette blob
; (DATA_master_palette_rom_blob = $3F:A000) into the CGRAM mirror at !s_cgram_mirror and
; the secondary mirror at $70:2D6C.
; Raidenthequick: CODE_load_palettes.
;
; INPUTS:   X = byte offset into DATA_scene_palette_layout (start of palette
;           program); DP $10..$1C may hold per-pointer indirection sources.
; OUTPUTS:  CGRAM mirror written for each program entry; X past terminator
;           on exit.
; MODIFIES: $00-$09 (source / index scratch); A, X, Y. M/X both 16-bit on
;           entry, restored to 8-bit on exit.
; CALLERS:  CODE_load_level_palettes (fall-through, X=0); CODE_00BAEA (X=$26);
;           CODE_00BB05 (JSL-callable wrapper, X user-supplied);
;           CODE_load_world_map_palettes (per-world world-map, X=$6E); CODE_load_yoshi_color_palette (Yoshi
;           color only, X=$C2); CODE_load_levelmode_0A_palettes (X=$D8).
;
; Note (glitch): the initial LDA #DATA_master_palette_rom_blob only sets the low word -- the
; high byte at $01 is left from the previous iteration. The very first run
; after boot picks up an uninitialised value here, which manifests as the
; "Yoshi running on the world map" glitch in the original V1.0 (see Glitch
; note inline below).
;-------------------------------------------------------------------------
CODE_00BA7A:
CODE_load_palettes:                                ; Raidenthequick: CODE_load_palettes
	LDA.w #DATA_master_palette_rom_blob						; Glitch: This pointer unintentionally affects what Yoshi initially runs on the map screen.
	STA.b $00
	LDA.w #DATA_master_palette_rom_blob>>8
	STA.b $01
CODE_00BA84:
	LDA.w DATA_scene_palette_layout,x
	BPL.b CODE_00BA95
	CMP.w #$FFFF
	BEQ.b CODE_00BADE
	AND.w #$7FFF
	TAY
	LDA.w $0010,y
CODE_00BA95:
	TAY
	LDA.w DATA_scene_palette_layout+$03,x
	AND.w #$000F
	STA.b $03
	LDA.w DATA_scene_palette_layout+$03,x
	AND.w #$00F0
	LSR
	LSR
	LSR
	LSR
	STA.b $05
	LDA.w DATA_scene_palette_layout+$02,x
	AND.w #$00FF
	ASL
	STA.b $07
	PHX
CODE_00BAB4:
	TAX
	LDA.b $03
	STA.b $09
CODE_00BAB9:
	LDA.b [$00],y
	STA.l YI_Global_PaletteMirror[$00].LowByte,x
	STA.l $702D6C,x
	INY
	INY
	INX
	INX
	DEC.b $09
	BNE.b CODE_00BAB9
	LDA.b $07
	CLC
	ADC.w #$0020
	STA.b $07
	DEC.b $05
	BNE.b CODE_00BAB4
	PLX
	INX
	INX
	INX
	INX
	BRA.b CODE_00BA84

CODE_00BADE:
	SEP.b #$30
	PLB
	RTL

;---------------------------------------------------------------------------

DATA_00BAE2:
	dw $293C,$297A

DATA_00BAE6:
	dw $2CAE,$2CCC

CODE_00BAEA:
	PHB
	PHK
	PLB
	REP.b #$20
	LDA.w DATA_00BAE2,x
	STA.b $10
	INC
	INC
	STA.b $12
	LDA.w DATA_00BAE6,x
	STA.b $14
	REP.b #$10
	LDX.w #$0026
	JMP.w CODE_load_palettes

;---------------------------------------------------------------------------

CODE_00BB05:
	PHB
	PHK
	PLB
	JMP.w CODE_load_palettes

;---------------------------------------------------------------------------

DATA_00BB0B:
	dw $3ADE,$3B5A,$3BD6,$3C52,$3CCE,$3D4A

DATA_00BB17:
	dw $3AE2,$3B00,$3B1E,$3B3C,$3B5E,$3B7C,$3B9A,$3BB8
	dw $3BDA,$3BF8,$3C16,$3C34,$3C56,$3C74,$3C92,$3CB0
	dw $3CD2,$3CF0,$3D0E,$3D2C,$3D4E,$3D6C,$3D8A,$3DA8

;-------------------------------------------------------------------------
; CODE_load_world_map_palettes -- world-map palette setup.
; Resolves a per-world palette pointer (DATA_00BB0B), 4 sub-pointers
; (DATA_00BB17 quadruples per world), stuffs them at DP $10/$12/$14/$16/
; $18, then runs CODE_load_palettes starting at X=$6E.
;-------------------------------------------------------------------------
CODE_00BB47:
CODE_load_world_map_palettes:
	PHB
	PHK
	PLB
	LDX.w !RAM_YI_Level_CurrentWorldLo
	LDA.w DATA_00BB0B,x
	STA.b $10
	TXA
	ASL
	ASL
	TAX
	LDA.w DATA_00BB17,x
	STA.b $12
	LDA.w DATA_00BB17+$02,x
	STA.b $14
	LDA.w DATA_00BB17+$04,x
	STA.b $16
	LDA.w DATA_00BB17+$06,x
	STA.b $18
	LDX.w #$006E
	JMP.w CODE_load_palettes

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_load_yoshi_color_palette -- Yoshi-color palette only.
; Used during Yoshi-color cycling on the world map (player select +
; egg-getting). Initialises COLDATA mirror to white-fade ($7F94) and CGRAM
; backdrop to $0000, then runs CODE_load_palettes at X=$C2.
;-------------------------------------------------------------------------
CODE_00BB70:
CODE_load_yoshi_color_palette:
	PHB
	PHK
	PLB
	LDA.w #$7F94
	STA.w $0948
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$00].LowByte
	LDA.w !RAM_YI_Level_CurrentYoshiColorLo
	ASL
	TAX
	LDA.w DATA_yoshi_palette_ptrs,x
	STA.b $10
	LDX.w #$00C2
	JMP.w CODE_load_palettes

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_load_levelmode_0A_palettes (CODE_00BB90) -- hardcoded palette loader
; for level-mode $0A (6-8 Kamek autoscroll). Picks Yoshi and Sprite
; palettes from header, then runs CODE_load_palettes at X=$D8.
; Raidenthequick: CODE_load_levelmode_0A_palettes.
;-------------------------------------------------------------------------
CODE_00BB90:
CODE_load_levelmode_0A_palettes:                   ; Raidenthequick: CODE_load_levelmode_0A_palettes
	PHB
	PHK
	PLB
	REP.b #$30
	LDA.w !RAM_YI_Level_CurrentYoshiColorLo
	ASL
	TAY
	LDA.w DATA_yoshi_palette_ptrs,y
	STA.b $10
	LDA.w !RAM_YI_Level_LevelHeaderSpritePaletteLo
	ASL
	TAY
	LDA.w DATA_sprite_palette_ptrs,y
	STA.b $12
	LDX.w #$00D8
	JMP.w CODE_load_palettes

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; DATA_scene_layout_indices -- 22-entry word table.
; Raidenthequick: DATA_scene_layout_indices.
; Each entry = byte offset into DATA_scene_register_layout. Indexed
; by !RAM_YI_Level_LevelHeaderLevelModeLo at CODE_init_scene_regs to select which
; 20-byte scene-register row applies to this scene (entries are stride 20).
;-------------------------------------------------------------------------
DATA_00BBAF:
DATA_scene_layout_indices:                         ; Raidenthequick: DATA_scene_layout_indices
	dw $0000,$0014,$0028,$003C,$0050,$0064,$0078,$008C
	dw $00A0,$00B4,$00C8,$00DC,$00F0,$0104,$0118,$012C
	dw $0140,$0154,$0168,$01A4,$017C,$0190

;-------------------------------------------------------------------------
; DATA_reg_mirror_mapping -- 15-byte map: which $21xx PPU register
; corresponds to each entry in the per-scene VRAM register mirror block
; ($095E..$096C). Used by CODE_init_scene_regs's .init_registers loop, where it
; iterates X from $0E down to 0 issuing STA ($00),y with $00..$01 = $2100.
; Raidenthequick: DATA_reg_mirror_mapping.
;-------------------------------------------------------------------------
DATA_00BBDB:
DATA_reg_mirror_mapping:                           ; Raidenthequick: DATA_reg_mirror_mapping
	db !REGISTER_BGModeAndTileSizeSetting
	db !REGISTER_BG1AddressAndSize
	db !REGISTER_BG2AddressAndSize
	db !REGISTER_BG3AddressAndSize
	db !REGISTER_BG1And2TileDataDesignation
	db !REGISTER_BG3And4TileDataDesignation
	db !REGISTER_BG1And2WindowMaskSettings
	db !REGISTER_BG3And4WindowMaskSettings
	db !REGISTER_ObjectAndColorWindowSettings
	db !REGISTER_MainScreenLayers
	db !REGISTER_SubScreenLayers
	db !REGISTER_MainScreenWindowMask
	db !REGISTER_SubScreenWindowMask
	db !REGISTER_ColorMathInitialSettings
	db !REGISTER_ColorMathSelectAndEnable

;-------------------------------------------------------------------------
; DATA_scene_register_layout -- 22 rows of 20 bytes each.
; Raidenthequick: DATA_scene_register_layout.
;
; Each row drives CODE_init_scene_regs for one level mode. Bytes:
;   $00 = interrupt_mode index (set !r_interrupt_mode = $011B-adjacent;
;         picks which NMI-table handler runs)
;   $01 = IRQ-kind index ($0014 = "DATA_irq_kind" pointer table lookup)
;   $02 = SCBR mirror ($012D) -- SuperFX screen-base
;   $03 = SCMR mirror ($012E) -- SuperFX screen-mode
;   $04 = flag: if non-zero, do the "scroll bgcolor down by one CGRAM row"
;         trick (used by scenes with a coldata mode-7 backdrop)
;   $05-$13 = 15 PPU register mirror values copied to $095E-$096C and from
;         there to actual $21xx registers via DATA_reg_mirror_mapping
;-------------------------------------------------------------------------
DATA_00BBEA:
DATA_scene_register_layout:                        ; Raidenthequick: DATA_scene_register_layout
	db $06,$00,$0A,$1D,$00
	db $10,$3C,$3C,$3C,$22
	db $22,$32,$00,$00,$13
	db $00,$00,$00,$00,$3F
	db $00,$00,$16,$3D,$00
	db $01,$70,$74,$78,$00
	db $06,$00,$00,$00,$13
	db $00,$00,$00,$00,$00
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$17
	db $00,$00,$00,$22,$20
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$14
	db $03,$00,$00,$22,$20
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$13
	db $04,$00,$00,$22,$B3
	db $04,$00,$16,$3D,$01
	db $22,$69,$3A,$34,$77
	db $02,$00,$00,$00,$11
	db $02,$00,$00,$22,$20
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$13
	db $14,$00,$00,$22,$72
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$15
	db $02,$00,$00,$22,$20
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$15
	db $02,$00,$00,$22,$24
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$11
	db $06,$00,$00,$22,$20
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$13
	db $00,$00,$00,$22,$20
	db $0A,$00,$16,$3D,$01
	db $07,$00,$00,$00,$00
	db $00,$00,$00,$00,$11
	db $04,$00,$00,$22,$20
	db $02,$00,$16,$3D,$01
	db $00,$69,$28,$30,$77
	db $77,$00,$00,$00,$1F
	db $00,$00,$00,$02,$20
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$11
	db $06,$00,$00,$22,$20
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$15
	db $00,$00,$00,$22,$20
	db $02,$00,$16,$3D,$01
	db $59,$3A,$69,$34,$77
	db $02,$00,$00,$00,$05
	db $12,$00,$00,$22,$45
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$13
	db $04,$00,$00,$22,$B3
	db $02,$00,$16,$3D,$01
	db $69,$69,$3A,$34,$77
	db $02,$00,$00,$00,$04
	db $13,$00,$00,$22,$24
	db $08,$02,$16,$3D,$01
	db $09,$61,$69,$74,$00
	db $77,$00,$30,$00,$15
	db $02,$0A,$02,$02,$20
	db $0C,$00,$16,$1D,$00
	db $01,$1C,$1C,$15,$22
	db $01,$32,$00,$80,$17
	db $00,$00,$00,$10,$00
	db $0E,$06,$16,$3D,$01
	db $41,$6A,$3A,$34,$77
	db $02,$00,$00,$A0,$17
	db $00,$10,$00,$20,$94
	db $08,$04,$07,$1B,$00
	db $03,$50,$5C,$00,$50
	db $00,$00,$00,$00,$13
	db $00,$00,$00,$00,$00

;-------------------------------------------------------------------------
; CODE_init_scene_regs -- initialise PPU + SuperFX scene
; registers for a level-mode. Looks up DATA_scene_layout_indices[X*2] to find
; the matching DATA_scene_register_layout row, then:
;   1. Stores first 4 bytes (interrupt_mode, IRQ kind, SCBR, SCMR) to
;      $011C/$0126/$012D/$012E.
;   2. If row byte 4 != 0, scrolls the CGRAM backdrop down a row (COLDATA
;      mirror trick used by gradient-backdrop scenes).
;   3. Copies bytes 5..19 to !RAM_YI_Global_BGModeAndTileSizeSetting (15
;      register mirrors at $095E..$096C).
;   4. STZs HDMA mirror and BG4SC.
;   5. Walks the 15 mirrors back out to actual $21xx registers via
;      DATA_reg_mirror_mapping.
;   6. Clears window-logic, sets OAM size/data designation to $02, clears
;      SETINI.
; Raidenthequick: CODE_init_scene_regs.
;
; INPUTS:   X = scene-mode index (0..21); !s_cgram_mirror[$00] is read
;           for the backdrop-row-scroll path.
; OUTPUTS:  All $21xx register mirrors at $095E..$096C populated;
;           corresponding $2100-$2133 PPU regs written; $0948 (COLDATA
;           mirror) updated on backdrop-scroll path.
; MODIFIES: DBR pushed; A, X, Y; DP $00-$01 (set to $2100 register base);
;           $011C/$0126/$012D/$012E/$0948/$095E-$096C; PPU regs.
; CALLERS:  scene-load chain (all level-mode setup paths); cutscene
;           reload; CODE_load_levelmode_0A_gfx (CODE_00B4D3 with X=$18).
;-------------------------------------------------------------------------
CODE_00BDA2:
CODE_init_scene_regs:                              ; Raidenthequick: CODE_init_scene_regs
	PHB
	PHK
	PLB
	REP.b #$10
	LDY.w DATA_scene_layout_indices,x
	LDA.w DATA_scene_register_layout,y
	STA.w $011C
	LDA.w DATA_scene_register_layout+$01,y
	STA.w $0126
	LDA.w DATA_scene_register_layout+$02,y
	STA.w $012D
	LDA.w DATA_scene_register_layout+$03,y
	STA.w $012E
	LDA.w DATA_scene_register_layout+$04,y
	BEQ.b CODE_00BDE5
	REP.b #$20
	LDA.l YI_Global_PaletteMirror[$00].LowByte
	STA.w $0948
	STA.l YI_Global_PaletteMirror[$10].LowByte
	STA.l $702D8C
	LDA.w #$0000
	STA.l YI_Global_PaletteMirror[$00].LowByte
	STA.l $702D6C
	SEP.b #$20
CODE_00BDE5:
	LDX.w #$0000
CODE_00BDE8:
	LDA.w DATA_scene_register_layout+$05,y
	STA.w !RAM_YI_Global_BGModeAndTileSizeSetting,x
	INY
	INX
	CPX.w #$000F
	BCC.b CODE_00BDE8
	STZ.w !RAM_YI_Global_HDMAEnable
	STZ.w !REGISTER_BG4AddressAndSize
	LDY.w #!REGISTER_ScreenDisplayRegister
	STY.b $00
	SEP.b #$10
	LDX.b #$0E
CODE_00BE04:
	LDY.w DATA_reg_mirror_mapping,x
	LDA.w !RAM_YI_Global_BGModeAndTileSizeSetting,x
	STA.b ($00),y
	DEX
	BPL.b CODE_00BE04
	REP.b #$20
	STZ.w !RAM_YI_Global_BGWindowLogicSettings
	STZ.w !REGISTER_BGWindowLogicSettings
	SEP.b #$20
	LDA.b #$02
	STA.w !RAM_YI_Global_OAMSizeAndDataAreaDesignation
	STA.w !REGISTER_OAMSizeAndDataAreaDesignation
	STZ.w !REGISTER_InitialScreenSettings
	PLB
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_copy_division_lookup_to_sram -- MVN-copy the 1024-byte
; 1/x division LUT from ROM (DATA_div_onebyx_lut at $00:E552) to SRAM at
; $70:2200. SuperFX divide-by-x routines fetch from this SRAM mirror.
; Raidenthequick: CODE_copy_division_lookup_to_sram.
;
; INPUTS:   none.
; OUTPUTS:  $70:2200..$70:25FF = DATA_div_onebyx_lut contents.
; MODIFIES: A/X/Y; DBR pushed/popped; MVN moves the bytes block-style.
; CALLERS:  scene-load chain in Bank01/0F/17 (called before any SuperFX
;           routine that needs reciprocal lookups -- camera math, sprite
;           perspective scaling).
;-------------------------------------------------------------------------
CODE_00BE26:
CODE_copy_division_lookup_to_sram:                 ; Raidenthequick: CODE_copy_division_lookup_to_sram
	REP.b #$30
	PHB
	LDY.w #$702200
	LDX.w #DATA_div_onebyx_lut
	LDA.w #$03FF
	MVN $702200>>16,DATA_div_onebyx_lut>>16
	PLB
	SEP.b #$30
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_queue_dma_4args -- caller-arg-shaped DMA queueing helper.
; The 4 words following the JSL are treated as arguments (dst-long,
; src-long, size) stuffed into the DMA argument buffer at $096F..$0977
; indexed by $096D. The return address is bumped past the 8 inline bytes.
;
; INPUTS:   8 bytes of inline data after the JSL: dst-long, src-long,
;           size; $096D = current arg-buffer offset.
; OUTPUTS:  arg buffer extended by 8 bytes; $096D incremented by 8;
;           caller PC bumped past the inline data so RTL skips it.
; MODIFIES: A, X, Y; $096D-$0977 within current row; stack-relative
;           return address.
; CALLERS:  CODE_process_multi_wram_dma_queue and other tilemap-init DMA paths that bundle
;           multiple DMA descriptors into a buffer processed in NMI.
;-------------------------------------------------------------------------
CODE_00BE39:
CODE_queue_dma_4args:
	PHP
	REP.b #$30
	LDX.w $096D
	LDA.b $02,S
	TAY
	LDA.w $0007,y
	STA.w $096F,x
	LDA.w $0001,y
	STA.w $0971,x
	LDA.w $0003,y
	STA.w $0973,x
	LDA.w $0005,y
	STA.w $0975,x
	LDA.w #$0000
	STA.w $0977,x
	TXA
	CLC
	ADC.w #$0008
	STA.w $096D
	TYA
	CLC
	ADC.w #$0008
	STA.b $02,S
	PLP
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_queue_dma_3args_plus_a -- like CODE_queue_dma_4args, but A
; supplies the first slot (instead of an inline word) and only 6 bytes
; of inline data follow. Caller PC bumped by 6.
;-------------------------------------------------------------------------
CODE_00BE71:
CODE_queue_dma_3args_plus_a:
	PHP
	REP.b #$10
	LDX.w $096D
	STA.w $096F,x
	LDA.b $02,S
	TAY
	LDA.w $0001,y
	STA.w $0971,x
	LDA.w $0003,y
	STA.w $0973,x
	LDA.w $0005,y
	STA.w $0975,x
	LDA.w #$0000
	STA.w $0977,x
	TXA
	CLC
	ADC.w #$0008
	STA.w $096D
	TYA
	CLC
	ADC.w #$0006
	STA.b $02,S
	PLP
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; vram_dma_queue_add_* (CODE_vram_dma_queue_add_180_2118 / CODE_00BEDA / CODE_00BF16 / CODE_00BF4A
; / CODE_00BF86 / DATA_00BFBA) -- six near-identical VRAM-DMA-queue
; appenders. Each pushes one new entry onto the queue at $7E:4800.
; Differences are in (a) VRAM destination register (low byte of
; $002115/$002116/$002118/$002119) and (b) DMA control mode (read/write,
; fixed/auto, 1-reg vs 2-reg). The full queue is processed in NMI by
; CODE_process_vram_dma_queue.
;
; Queue entry layout (12 bytes; see CODE_process_tilemap_dma_queue header):
;   $00-$01 = VRAM dest address (high bit = end-of-queue marker)
;   $02-$03 = video port control + flags + transfer size
;   $04     = DMA destination register low byte
;   $05-$07 = source address (long)
;   $08-$09 = DMA size
;   $0A-$0B = pointer to next entry
;
; INPUTS:   A = DMA size, Y = VRAM dest, X = source address, $0001 = src bank.
; OUTPUTS:  entry appended; $7E:4800 advanced to next slot.
; MODIFIES: DBR pushed to $7E; A, X.
; CALLERS:  CODE_vram_dma_queue_add_180_2118 -- most common (mode $0180, dest $2118):
;             tilemap update writes by Bank01/0F sprite render.
;           CODE_00BEDA -- "fixed transfer" variant (likely unused, Raidenthe-
;             quick comment "bugged size").
;           CODE_00BF16 -- write-only / no auto-increment ($00 + $2118).
;           CODE_00BF4A -- fixed-transfer no-inc (likely unused).
;           CODE_00BF86 -- dest $2119 instead of $2118 (mode 0080).
;           CODE_00BFBA -- dest $2119 fixed transfer (mode 0880).
;-------------------------------------------------------------------------

CODE_00BEA6:
CODE_vram_dma_queue_add_180_2118:
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	PHX
	LDX.w $7E4800
	STA.w $0008,x
	TYA
	STA.w $0000,x
	LDA.w #$0180
	STA.w $0002,x
	LDA.w #!REGISTER_WriteToVRAMPortLo&$00FF
	STA.w $0004,x
	LDA.w $0000
	STA.w $0006,x
	PLA
	STA.w $0005,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	STA.w $7E4800
	PLB
	RTL

;---------------------------------------------------------------------------

CODE_00BEDA:
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	PHX
	LDX.w $7E4800
	STA.w $0008,x
	TYA
	STA.w $0000,x
	LDA.w #$0980
	STA.w $0002,x
	LDA.w #$0018
	STA.w $0004,x
	LDA.w #$7E4800>>8
	STA.w $0006,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $0005,x
	TXA
	CLC
	ADC.w #$000D
	STA.w $000A,x
	STA.w $7E4800
	PLA
	STA.w $000C,x
	PLB
	RTL

;---------------------------------------------------------------------------

CODE_00BF16:
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	PHX
	LDX.w $7E4800
	STA.w $0008,x
	TYA
	STA.w $0000,x
	LDA.w #$0000
	STA.w $0002,x
	LDA.w #$0018
	STA.w $0004,x
	LDA.w $0000
	STA.w $0006,x
	PLA
	STA.w $0005,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	STA.w $7E4800
	PLB
	RTL

;---------------------------------------------------------------------------

CODE_00BF4A:
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	PHX
	LDX.w $7E4800
	STA.w $0008,x
	TYA
	STA.w $0000,x
	LDA.w #$0800
	STA.w $0002,x
	LDA.w #$0018
	STA.w $0004,x
	LDA.w #$7E4800>>8
	STA.w $0006,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $0005,x
	TXA
	CLC
	ADC.w #$000D
	STA.w $000A,x
	STA.w $7E4800
	PLA
	STA.w $000C,x
	PLB
	RTL

;---------------------------------------------------------------------------

CODE_00BF86:
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	PHX
	LDX.w $7E4800
	STA.w $0008,x
	TYA
	STA.w $0000,x
	LDA.w #$0080
	STA.w $0002,x
	LDA.w #$0019
	STA.w $0004,x
	LDA.w $0000
	STA.w $0006,x
	PLA
	STA.w $0005,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $000A,x
	STA.w $7E4800
	PLB
	RTL

;---------------------------------------------------------------------------

CODE_00BFBA:
	PHB
	PEA.w $7E4800>>8
	PLB
	PLB
	PHX
	LDX.w $7E4800
	STA.w $0008,x
	TYA
	STA.w $0000,x
	LDA.w #$0880
	STA.w $0002,x
	LDA.w #$0019
	STA.w $0004,x
	LDA.w #$7E4800>>8
	STA.w $0006,x
	TXA
	CLC
	ADC.w #$000C
	STA.w $0005,x
	TXA
	CLC
	ADC.w #$000D
	STA.w $000A,x
	STA.w $7E4800
	PLA
	STA.w $000C,x
	PLB
	RTL

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($00BC06, incbin, DATA_00BC06_YI_U2.bin)
else
	%FREE_BYTES($00BFF6, 10, $FF)
endif

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; YI_MainRAMCodeBlock -- start of the 16 KB block copied to $7E:C000 at
; boot. From here to ROMBANK00_END, all code/data is RELOCATED to WRAM
; by CODE_yi_reset (DMA via CODE_dma_wram_gen_purpose). At runtime, all NMI/IRQ
; vectors jump into this block via the trampolines at $7E:0108/$7E:010C
; (YI_VBlankRt = !RAM_YI_Global_VBlankRt and YI_IRQRt = !RAM_YI_Global_IRQRt).
;
; Why relocated to RAM: lets the NMI/IRQ paths run from FastROM-mirrored
; WRAM (8-cycle access) without depending on bank-$00 ROM, and lets late-
; loading patches overwrite the live trampolines.
;
; Address aliases: each label below has its $7E:Cxxx aliased counterpart
; defined in framework Memory/WRAM_RelocatedCode.asm.
;-------------------------------------------------------------------------

YI_MainRAMCodeBlock:

;-------------------------------------------------------------------------
; YI_VBlankRt (NMI handler) -- runs once per video frame at the start of
; vertical blank. Entered via $7E:0108 trampoline (RAM JML to
; !RAM_YI_Global_VBlankRt = $7E:C000 alias).
; Raidenthequick: NMI.
; See also: ys_main.asm (the NMI / VBlank handler in the upstream tree).
;
; Sequence:
;   1. SEI; push all regs; D=$0000; M=8/X=8; DBR=$00.
;   2. Read $4210 (RDNMI: clears NMI-flag latch).
;   3. JSR (DATA_interrupt_mode_nmi_handlers,X) with X=$011C -- dispatches per
;      scene mode. There are 8 handlers (DATA_interrupt_mode_nmi_handlers), index $00..$0E
;      stride 2. Handlers do all per-frame DMAs (OAM, palette, tilemap)
;      and update PPU register mirrors.
;   4. CODE_play_music_track: if $51 (PlayMusic) is non-zero AND the SPC is
;      "ready" (CMP $2140 == previous music ID), write to APU port 0 to
;      start the new track; cache it as previous.
;   5. CODE_handle_sound: process the sound queue and post one sound to APU
;      port 3 per frame. Implements a "shuffle-down" queue (max 6 entries)
;      so multiple simultaneous calls to CODE_push_sound_queue serialise across
;      consecutive frames.
;   6. Pop regs and RTI.
;
; INPUTS:   $011C = interrupt_mode (set by CODE_init_scene_regs); $51 = PlayMusic;
;           !RAM_YI_Global_PreviousMusicLo, PlaySoundHighPriorityLo, etc;
;           SoundQueue (up to 7 bytes at $RAM_YI_Global_SoundQueue).
; OUTPUTS:  $2100-$2140 PPU regs updated by handler; APU ports 0/1/3 may
;           be written; SoundQueue shrunk; $011B (frame-complete sentinel)
;           may be decremented by handler (CODE_nmi_normal_level etc).
; MODIFIES: A, X, Y, DP, DBR (all pushed/popped).
; CALLERS:  hardware NMI vector $00:FFEA -> $7E:0108 -> JML here.
;
; (See also the per-mode NMI handlers below: CODE_nmi_normal_level is "main level
; mode", CODE_nmi_world_map_cutscene is "world map", CODE_nmi_bonus_raphael_mode7 is "bonus / Raphael" --
; each handles the heavy-lift of per-frame DMA into PPU.)
;-------------------------------------------------------------------------
YI_VBlankRt:
;$00C000
	SEI
	REP.b #$38
	PHA
	PHX
	PHY
	PHD
	PHB
	LDA.w #$0000
	TCD
	SEP.b #$30
if !CurrentBank != $00
	LDA.b #YI_VBlankRt>>16
endif
	PHA
	PLB
	LDY.w !REGISTER_NMIEnable
	LDX.w $011C
	JSR.w (DATA_interrupt_mode_nmi_handlers,x)
	LDA.b !RAM_YI_Global_PlayMusicLo
	BNE.b CODE_play_music_track
	LDX.w !REGISTER_APUPort0
	CPX.b !RAM_YI_Global_PreviousMusicLo
	BNE.b CODE_handle_sound
CODE_00C024:
CODE_play_music_track:                             ; Raidenthequick: CODE_play_music_track
	STA.w !REGISTER_APUPort0
	STA.b !RAM_YI_Global_PreviousMusicLo
	STZ.b !RAM_YI_Global_PlayMusicLo
CODE_00C02B:
CODE_handle_sound:                                 ; Raidenthequick: CODE_handle_sound
	LDA.b $51
	STA.w !REGISTER_APUPort1
	STZ.b $51
	LDA.w !REGISTER_APUPort3
	CMP.b !RAM_YI_Global_PreviousHighPrioritySoundLo
	BNE.b CODE_00C06C
	LDY.b !RAM_YI_Global_PlaySoundHighPriorityLo
	BEQ.b CODE_00C045
	CMP.b !RAM_YI_Global_PlaySoundHighPriorityLo
	BEQ.b CODE_00C04D
	STZ.b !RAM_YI_Global_PlaySoundHighPriorityLo
	BRA.b CODE_00C067

CODE_00C045:
	LDX.b !RAM_YI_Global_SoundQueueSizeLo
	BEQ.b CODE_00C067
	CMP.b !RAM_YI_Global_SoundQueue
	BNE.b CODE_00C051
CODE_00C04D:
	LDY.b #$00
	BRA.b CODE_00C067

CODE_00C051:
	DEX
	CPX.b #$07
	BCC.b CODE_00C058
	LDX.b #$06
CODE_00C058:
	STX.b !RAM_YI_Global_SoundQueueSizeLo
	LDY.b !RAM_YI_Global_SoundQueue
	LDX.b #$00
CODE_00C05E:
	LDA.b !RAM_YI_Global_SoundQueue+$01,x
	STA.b !RAM_YI_Global_SoundQueue,x
	INX
	CPX.b !RAM_YI_Global_SoundQueueSizeLo
	BCC.b CODE_00C05E
CODE_00C067:
	STY.w !REGISTER_APUPort3
	STY.b !RAM_YI_Global_PreviousHighPrioritySoundLo
CODE_00C06C:
	REP.b #$30
	PLB
	PLD
	PLY
	PLX
	PLA
	RTI

;-------------------------------------------------------------------------
; DATA_interrupt_mode_nmi_handlers -- 8-entry word dispatch
; for the NMI handler, indexed by $011C (interrupt_mode). Set by
; CODE_init_scene_regs from the first byte of each DATA_scene_register_layout row.
;
; Entries:
;   $00 = CODE_nmi_normal_level ($01:6) -- main level mode (full per-frame DMA chain)
;   $02 = CODE_nmi_null           -- null handler (just RTS; scene's DMA
;                                  done elsewhere, e.g. Nintendo Logo)
;   $04 = CODE_nmi_null           -- null
;   $06 = CODE_nmi_bonus_raphael_mode7           -- bonus/Raphael Mode-7 path (DMA + M7)
;   $08 = CODE_nmi_null           -- null
;   $0A = CODE_nmi_null           -- null
;   $0C = CODE_nmi_world_map_cutscene           -- world map / story cutscene path
;   $0E = CODE_nmi_null           -- null
;-------------------------------------------------------------------------
DATA_00C074:
DATA_interrupt_mode_nmi_handlers:
	dw CODE_nmi_normal_level                            ; $00 normal level mode
	dw CODE_nmi_null                            ; $02 (RTS only)
	dw CODE_nmi_null                            ; $04 (RTS only)
	dw CODE_nmi_bonus_raphael_mode7                            ; $06 bonus / Raphael Mode-7
	dw CODE_nmi_null                            ; $08 (RTS only)
	dw CODE_nmi_null                            ; $0A (RTS only)
	dw CODE_nmi_world_map_cutscene                            ; $0C world map / cutscene
	dw CODE_nmi_null                            ; $0E (RTS only)

;-------------------------------------------------------------------------
; CODE_nmi_normal_level -- the heaviest NMI path. Runs during
; gameplay (level mode). Force-blanks, disables HDMA, then if $011B (frame-
; complete sentinel) is non-zero, processes the full per-frame DMA chain:
;   * CODE_process_vram_dma_queue: drain the OAM/tile staging
;     queue at $7E:4800.
;   * CODE_prepare_tilemap_dma_queue: pick + run the active
;     tilemap-DMA queue selected by $0127.
;   * CODE_00D4AC: DMA OAM ($0220 bytes from $7E:6A00 to PPU OAM via DMA0).
;   * CODE_00D4E5: DMA the COLDATA mirror + CGRAM mirror to PPU.
;   * CODE_bg3_tilemap_flush: copy BG3 tilemap stitching.
;   * update_controllers (CODE_00E507): read joypad regs.
; Finally copies layer scroll positions ($30..$44 dp aliased to
; !RAM_YI_Global_LayerNXposLo etc) to PPU $210D-$2114, then restores
; INIDISP from $0200 mirror and HDMA from the HDMA mirror.
; Raidenthequick: CODE_nmi_normal_level (no descriptive label; "main level NMI").
;-------------------------------------------------------------------------
CODE_00C084:
CODE_nmi_normal_level:
	LDY.b #$8F
	STY.w !REGISTER_ScreenDisplayRegister
	STZ.w !REGISTER_HDMAEnable
	LDA.w $011B
	BNE.b CODE_00C094
	JMP.w CODE_00C0FD

CODE_00C094:
	STZ.w $011B
	JSR.w CODE_process_vram_dma_queue
	JSR.w CODE_prepare_tilemap_dma_queue
	REP.b #$20
	LDA.w #!REGISTER_DMAEnable
	TCD
	LDX.b #$01
	JSR.w CODE_00D4AC
	JSR.w CODE_00D4E5
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	JSR.w CODE_bg3_tilemap_flush
	LDA.w #$0000
	TCD
	SEP.b #$20
	JSR.w CODE_00E507
	LDA.b !RAM_YI_Global_Layer1XPosLo
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer1XPosHi
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.b !RAM_YI_Global_Layer1YPosHi
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.b !RAM_YI_Global_Layer2XPosLo
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2XPosHi
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosLo
	STA.w !REGISTER_BG2VertScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosHi
	STA.w !REGISTER_BG2VertScrollOffset
	LDA.b !RAM_YI_Global_Layer3XPosLo
	STA.w !REGISTER_BG3HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer3XPosHi
	STA.w !REGISTER_BG3HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer3YPosLo
	STA.w !REGISTER_BG3VertScrollOffset
	LDA.b !RAM_YI_Global_Layer3YPosHi
	STA.w !REGISTER_BG3VertScrollOffset
CODE_00C0FD:
	LDA.w $0200
	STA.w !REGISTER_ScreenDisplayRegister
	LDA.w !RAM_YI_Global_HDMAEnable
	STA.w !REGISTER_HDMAEnable
	RTS

CODE_00C10A:
CODE_nmi_null:                                     ; null NMI path -- pure RTS
	RTS

;-------------------------------------------------------------------------
; CODE_nmi_world_map_cutscene -- NMI handler for world map and
; story cutscenes. Force-blanks, processes the VRAM/tilemap queues, runs
; OAM/COLDATA DMA, then writes per-frame state into the SuperFX scratch
; area at $7E:5740/5B59/5B5B/5B5E/etc. (the cutscene engine reads these
; from the SuperFX side).
;-------------------------------------------------------------------------
CODE_00C10B:
CODE_nmi_world_map_cutscene:
	LDY.b #$8F
	STY.w !REGISTER_ScreenDisplayRegister
	STZ.w !REGISTER_HDMAEnable
	LDA.w !RAM_YI_Global_ColorMathInitialSettings
	STA.w !REGISTER_ColorMathInitialSettings
	LDA.w $0994
	ORA.b #$80
	STA.w !REGISTER_FixedColorData
	LDA.w $0992
	ORA.b #$40
	STA.w !REGISTER_FixedColorData
	LDA.w $0990
	ORA.b #$20
	STA.w !REGISTER_FixedColorData
	LDA.w $011B
	BNE.b CODE_00C139
	JMP.w CODE_00C1DF

CODE_00C139:
	STZ.w $011B
	JSR.w CODE_process_vram_dma_queue
	JSR.w CODE_prepare_tilemap_dma_queue
	REP.b #$20
	LDA.w #!REGISTER_DMAEnable
	TCD
	LDX.b #$01
	JSR.w CODE_00D4AC
	JSR.w CODE_00D510
	LDA.w #$0000
	TCD
	LDA.b !RAM_YI_Global_Layer1XPosLo
	STA.l $7E5B59
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.l $7E5B5B
	LDA.b $69
	STA.l $7E5B5E
	LDA.b $6B
	STA.l $7E5B60
	LDA.b !RAM_YI_Global_Layer2XPosLo
	STA.l $7E5B99
	LDA.b !RAM_YI_Global_Layer2YPosLo
	STA.l $7E5B9B
	LDA.b $6D
	STA.l $7E5B9E
	LDA.b $6F
	STA.l $7E5BA0
	LDA.w $1144
	STA.l $7E5740
	SEP.b #$20
	LDA.w !RAM_YI_Global_ColorMathSelectAndEnable
	STA.l $7E5C9B
	JSR.w CODE_00E507
	LDA.w !RAM_YI_Global_MainScreenWindowMask
	STA.w !REGISTER_MainScreenWindowMask
	LDA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	STA.w !REGISTER_ObjectAndColorWindowSettings
	LDA.b !RAM_YI_Global_Layer1XPosLo
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer1XPosHi
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.b !RAM_YI_Global_Layer1YPosHi
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.b !RAM_YI_Global_Layer2XPosLo
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2XPosHi
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosLo
	STA.w !REGISTER_BG2VertScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosHi
	STA.w !REGISTER_BG2VertScrollOffset
	LDA.b !RAM_YI_Global_Layer3XPosLo
	STA.w !REGISTER_BG3HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer3XPosHi
	STA.w !REGISTER_BG3HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer3YPosLo
	STA.w !REGISTER_BG3VertScrollOffset
	LDA.b !RAM_YI_Global_Layer3YPosHi
	STA.w !REGISTER_BG3VertScrollOffset
CODE_00C1DF:
	LDA.w $0200
	STA.w !REGISTER_ScreenDisplayRegister
	LDA.w !RAM_YI_Global_HDMAEnable
	STA.w !REGISTER_HDMAEnable
	RTS

DATA_00C1EC:
	dw $4000,$6000,$4700,$6700,$5180,$7180

DATA_00C1F8:
	dw $7F56DE,$7F56DE,$7F64DE,$7F64DE,$7F79DE,$7F79DE

DATA_00C204:
	dw $0E00,$0E00,$1500,$1500,$1500,$1500

DATA_00C210:
	db $63,$62

DATA_00C212:
	db $3F,$BF

DATA_00C214:
	db $00,$50,$28,$00,$00,$00,$00,$00

DATA_00C21C:
	db $01,$00,$01,$00,$01,$00,$00,$00

DATA_00C224:
	db $FF,$FF,$FF,$00,$01,$01,$01,$00

;-------------------------------------------------------------------------
; CODE_nmi_bonus_raphael_mode7 -- NMI handler used by bonus games
; and the Raphael-the-Raven Mode-7 boss. The level-mode also drives DMA
; into Mode-7 character data ($7EC1E8-extended source table, indexed by
; $0980/$0984), and runs the per-CGADSUB fade animation tail at
; CODE_00C33E / CODE_00C3C3 to slowly fade the COLDATA mirror toward a
; per-mode target ($C212 / $C21C / $C224 inline tables).
;-------------------------------------------------------------------------
CODE_00C22C:
CODE_nmi_bonus_raphael_mode7:
	LDY.b #$8F
	STY.w !REGISTER_ScreenDisplayRegister
	STZ.w !REGISTER_HDMAEnable
	LDA.w $1139
	BEQ.b CODE_00C23B
	STA.b $51
CODE_00C23B:
	LDA.w !RAM_YI_Global_ColorMathSelectAndEnable
	STA.w !REGISTER_ColorMathSelectAndEnable
	LDA.w $0994
	ORA.b #$80
	STA.w !REGISTER_FixedColorData
	LDA.w $0992
	ORA.b #$40
	STA.w !REGISTER_FixedColorData
	LDA.w $0990
	ORA.b #$20
	STA.w !REGISTER_FixedColorData
	REP.b #$20
	INC.w $0131
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDY.b #$01
	SEP.b #$20
	LDA.w $0980
	BEQ.b CODE_00C29E
	ASL
	ORA.w $0984
	ASL
	TAX
	REP.b #$20
	LDA.l !RAM_YI_Global_DATA_00C1EC-$04,x
	STA.w !REGISTER_VRAMAddressLo
	LDA.l !RAM_YI_Global_DATA_00C1F8-$04,x
	STA.w DMA[$00].SourceLo
	LDA.l !RAM_YI_Global_DATA_00C204-$04,x
	STA.w DMA[$00].SizeLo
	LDX.b #$7F56DE>>16
	STX.w DMA[$00].SourceBank
	STY.w !REGISTER_DMAEnable
	SEP.b #$20
	DEC.w $0980
	BNE.b CODE_00C2A3
CODE_00C29E:
	LDA.w $011B
	BNE.b CODE_00C2A6
CODE_00C2A3:
	JMP.w CODE_00C33E

CODE_00C2A6:
	STZ.w $011B
	LDA.w $0982
	STZ.w $0982
	STA.w $0980
	JSR.w CODE_process_vram_dma_queue
	REP.b #$20
	LDA.w #!REGISTER_DMAEnable
	TCD
	LDX.b #$01
	JSR.w CODE_00D4AC
	JSR.w CODE_00D510
	LDA.w #$7E5040
	STA.w !REGISTER_WRAMAddressLo
	LDY.b #$7E5040>>16
	STY.w !REGISTER_WRAMAddressBank
	LDA.w #((!REGISTER_ReadOrWriteToWRAMPort&$0000FF)<<8)+$00
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	LDA.w #$006CAA
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #$006CAA>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$0380
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w #$0000
	TCD
	SEP.b #$20
	LDY.w $0984
	LDA.w DATA_00C210,y
	STA.w !REGISTER_OAMSizeAndDataAreaDesignation
	LDA.w !RAM_YI_Global_MainScreenWindowMask
	STA.w !REGISTER_MainScreenWindowMask
	LDA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	STA.w !REGISTER_ObjectAndColorWindowSettings
	LDA.b !RAM_YI_Global_Layer1XPosLo
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer1XPosHi
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.b !RAM_YI_Global_Layer1YPosHi
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.w $020E
	STA.w !REGISTER_Mode7CenterX
	LDA.w $020F
	STA.w !REGISTER_Mode7CenterX
	LDA.w $0210
	STA.w !REGISTER_Mode7CenterY
	LDA.w $0211
	STA.w !REGISTER_Mode7CenterY
	LDA.b !RAM_YI_Global_Layer2XPosLo
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2XPosHi
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosLo
	STA.w !REGISTER_BG2VertScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosHi
	STA.w !REGISTER_BG2VertScrollOffset
CODE_00C33E:
	REP.b #$20
	LDA.b !RAM_YI_Global_Layer3XPosLo
	CLC
	ADC.w $099E
	STA.b !RAM_YI_Global_Layer3XPosLo
	LSR
	STA.w $09BD
	LSR
	LSR
	LSR
	STA.w $09A1
	ADC.w $09BD
	STA.w $09B9
	ADC.w $09A1
	STA.w $09B5
	ADC.w $09A1
	STA.w $09B1
	ADC.w $09A1
	STA.w $09AD
	ADC.w $09A1
	STA.w $09A9
	ADC.w $09A1
	STA.w $09A5
	ADC.w $09A1
	STA.w $09A1
	SEP.b #$20
	LDA.w !RAM_YI_Global_BG1AddressAndSize
	STA.w !REGISTER_BG1AddressAndSize
	LDA.w !RAM_YI_Global_BG2AddressAndSize
	STA.w !REGISTER_BG2AddressAndSize
	LDA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	STA.l $7E5A19
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.l $7E5A99
	LDA.w $09A0
	STA.w HDMA[$01].Destination
	JSR.w CODE_00E507
	LDA.w $0200
	STA.w !REGISTER_ScreenDisplayRegister
	LDA.w !RAM_YI_Global_HDMAEnable
	STA.w !REGISTER_HDMAEnable
	LDA.w $098E
	BEQ.b CODE_00C3E7
	PHK
	PLB
	LDY.w $0201
	LDX.w DATA_00C212,y
	STX.w !RAM_YI_Global_ColorMathSelectAndEnable
	TYA
	ASL
	ASL
	TAY
	LDX.b #$04
CODE_00C3C3:
	DEC.w $0996,x
	BPL.b CODE_00C3E2
	LDA.w DATA_00C21C,y
	STA.w $0996,x
	LDA.w $0990,x
	CLC
	ADC.w DATA_00C224,y
	BPL.b CODE_00C3D9
	LDA.b #$00
CODE_00C3D9:
	CMP.b #$1F
	BCC.b CODE_00C3DF
	LDA.b #$1F
CODE_00C3DF:
	STA.w $0990,x
CODE_00C3E2:
	INY
	DEX
	DEX
	BPL.b CODE_00C3C3
CODE_00C3E7:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; YI_IRQRt (IRQ handler) -- entered via hardware IRQ vector $00:FFEE ->
; $7E:010C -> JML !RAM_YI_Global_IRQRt. IRQs are programmed per-scanline
; via H-IRQ/V-IRQ ($4207/$4209). YI uses up to 3 IRQs per frame to:
;   1. ($V=$08) Disable INIDISP (force-blank during top status bar).
;   2. ($V=$D8) Restore INIDISP (re-enable screen for status bar).
;   3. ($V=$DC) Heavy work (DMA tilemap/sprite updates that didn't fit
;      in NMI), then re-arm V-IRQ for next scanline.
;
; Outer wrapper: SEI; push all regs; D=$0000; M=8/X=8; DBR=$00; read
; TIMEUP ($4211) to clear IRQ-flag latch; index $0126 (= IRQ kind, set
; by CODE_init_scene_regs from DATA_scene_register_layout byte 1) into the 4-entry
; DATA_irq_kind table (DATA_irq_kind) and JSR (DATA_irq_kind,x).
;
; Raidenthequick: IRQ_Handler / IRQ_Start / IRQ_Return.
; See also: ys_main.asm (IRQ handler in the upstream tree).
;
; INPUTS:   $0125 = irq_count (which of N IRQs this frame); $0126 = DATA_irq_kind;
;           !RAM_YI_Global_HDMAEnable mirror; $0200 = INIDISP mirror;
;           $0121 = stage-intro flag (used by irq_1 to dispatch level-name
;           overlay tilemap updates).
; OUTPUTS:  PPU $2100 (INIDISP) and $420C (HDMA) toggled; H/V-IRQ scanlines
;           reprogrammed; $0125 incremented per IRQ.
; MODIFIES: A, X, Y, DP, DBR (all pushed/popped); processor flags via PHA.
; CALLERS:  hardware IRQ vector $00:FFEE -> $7E:010C -> JML here.
;-------------------------------------------------------------------------
YI_IRQRt:
IRQ_Handler:                                  ; Raidenthequick: IRQ_Handler
IRQ_Start:                                    ; Raidenthequick: IRQ_Start
;$00C3E8
	SEI
	REP.b #$38
	PHA
	PHX
	PHY
	PHD
	PHB
	LDA.w #$0000
	TCD
	SEP.b #$30
if !CurrentBank != $00
	LDA.b #YI_IRQRt>>16
endif
	PHA
	PLB
	LDA.w !REGISTER_IRQEnable
	LDX.w $0126
	JSR.w (DATA_irq_kind,x)
	REP.b #$30
	PLB
	PLD
	PLY
	PLX
	PLA
	CLI
	RTI

;-------------------------------------------------------------------------
; DATA_irq_kind -- 4-entry word IRQ dispatch table.
;   $00 = CODE_irq_default -- in-level normal IRQ:
;          IRQ0 = disable display, IRQ1 = restore + dispatch DATA_level_intro_irq_routines,
;          IRQ2 = call DATA_irq_vram_tx_routines for VRAM transfers.
;   $02 = CODE_irq_story_cutscene -- cutscene-mode IRQ.
;   $04 = CODE_irq_credits -- credits roll IRQ.
;   $06 = CODE_irq_bonus_game -- bonus game/bandit games.
;-------------------------------------------------------------------------
DATA_00C40A:
DATA_irq_kind:                                     ; Raidenthequick: DATA_irq_kind
	dw CODE_irq_default                            ; $00 CODE_irq_default
	dw CODE_irq_story_cutscene                            ; $02 CODE_irq_story_cutscene
	dw CODE_irq_credits                            ; $04 CODE_irq_credits
	dw CODE_irq_bonus_game                            ; $06 CODE_irq_bonus_game

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_irq_default -- in-level / normal scene IRQ. Branches on
; $0125 (irq_count):
;   * count=0 -> CODE_irq_0: wait for H-blank, restore HDMA from mirror,
;     STZ INIDISP (force-blank), set H-IRQ to $50 and V-IRQ to $08,
;     re-arm NMITIMEN to $B1 (NMI + VIRQ + auto-joypad), increment count.
;   * count=1 -> irq_1: wait for H-blank, restore INIDISP from $0200,
;     set H-IRQ to $50 and V-IRQ to $D8. If stage-intro flag $0121 is
;     non-zero, dispatch through DATA_level_intro_irq_routines inline overlay routines
;     (level-name fade animation), then CODE_irq_2 by V-IRQ at $DC.
;   * count=2 -> CODE_irq_2: do per-scanline VRAM-transfer routine selected
;     from DATA_irq_vram_tx_routines indexed by $011C
;     (interrupt_mode). For "normal level mode" (index $02) this is
;     CODE_irq_normal_level_mode, which handles BG1 horizontal
;     scroll + per-frame VRAM staging finalisation. Other entries route
;     to CODE_set_v_irq_return (RTS), CODE_irq_offset_per_tile_levels, the Raphael
;     Mode-7 IRQ, or the story-cutscene IRQ.
;-------------------------------------------------------------------------
CODE_00C412:
CODE_irq_default:                                  ; Raidenthequick: CODE_irq_default
	LDA.w $0125
	BNE.b CODE_00C43D
CODE_00C417:
CODE_irq_0:                                        ; Raidenthequick: CODE_irq_0

	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_irq_0
CODE_00C41C:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_00C41C
	LDA.w !RAM_YI_Global_HDMAEnable
	STA.w !REGISTER_HDMAEnable
	STZ.w !REGISTER_ScreenDisplayRegister
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$08
CODE_00C431:
CODE_next_irq:                                     ; Raidenthequick: CODE_next_irq
	INC.w $0125
CODE_00C434:
CODE_set_v_irq:                                    ; Raidenthequick: CODE_set_v_irq
	STA.w !REGISTER_VCountTimerLo
	LDA.b #$B1                                ; enable NMI + IRQ + auto-joypad
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
CODE_00C43C:
CODE_set_v_irq_return:                             ; Raidenthequick: CODE_set_v_irq_return
	RTS

;---------------------------------------------------------------------------

CODE_00C43D:
	DEC
	BNE.b CODE_irq_2
CODE_00C440:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_00C440
CODE_00C445:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_00C445
	LDA.w $0200
	STA.w !REGISTER_ScreenDisplayRegister
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$D8
	LDX.w $0121
	BNE.b CODE_00C45F
	JMP.w CODE_next_irq

CODE_00C45F:
	JSR.w CODE_next_irq
	JMP.w (DATA_level_intro_irq_routines,x)

CODE_00C465:
CODE_irq_2:                                        ; Raidenthequick: CODE_irq_2
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_irq_2
CODE_00C46A:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_00C46A
	LDY.b #$8F                                ; force-blank for VRAM xfer
	STY.w !REGISTER_ScreenDisplayRegister
	STZ.w !REGISTER_HDMAEnable
	LDX.w $011C
	JMP.w (DATA_irq_vram_tx_routines,x)

;-------------------------------------------------------------------------
; DATA_irq_vram_tx_routines -- 8-entry word dispatch consulted
; from CODE_irq_2. Indexed by $011C (interrupt_mode, set by CODE_init_scene_regs).
; Routes the "heavy VRAM transfer" IRQ to the right per-scene path:
;   $00 = CODE_set_v_irq_return         (Nintendo Logo: no transfer)
;   $02 = CODE_irq_normal_level_mode (normal level)
;   $04 = CODE_irq_offset_per_tile_levels (level mode $1 7-X/X-X4)
;   $06 = CODE_set_v_irq_return         (island scenes)
;   $08 = CODE_irq_story_cutscene_credits
;   $0A = CODE_irq_raphael_the_raven_boss
;   $0C = CODE_set_v_irq_return         (world map)
;   $0E = CODE_set_v_irq_return         (bonus/bandit games)
;-------------------------------------------------------------------------
DATA_00C47D:
DATA_irq_vram_tx_routines:                         ; Raidenthequick: DATA_irq_vram_tx_routines
	dw CODE_set_v_irq_return                            ; $00 CODE_set_v_irq_return
	dw CODE_irq_normal_level_mode                            ; $02 CODE_irq_normal_level_mode
	dw CODE_irq_offset_per_tile_levels                            ; $04 CODE_irq_offset_per_tile_levels
	dw CODE_set_v_irq_return                            ; $06 island scenes (no tx)
	dw CODE_irq_story_cutscene_credits                            ; $08 CODE_irq_story_cutscene_credits
	dw CODE_irq_raphael_the_raven_boss                            ; $0A CODE_irq_raphael_the_raven_boss
	dw CODE_set_v_irq_return                            ; $0C world map (no tx)
	dw CODE_set_v_irq_return                            ; $0E bonus/bandit games

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_irq_normal_level_mode -- the heavy VRAM-transfer IRQ for
; normal in-level scenes. Pre-blanked by CODE_irq_2. Steps:
;   * update Y-shake + BG1 V-scroll mirror.
;   * CODE_process_vram_dma_queue, CODE_prepare_tilemap_dma_queue (anything that
;     didn't fit in NMI).
;   * CODE_process_multi_wram_dma_queue (queued multi-WRAM DMA processor), CODE_00D4AC (OAM DMA),
;     CODE_00D4E5 (COLDATA/CGRAM DMA).
;   * Pause-menu special: if PauseScreenState >= $0C, DMA 12 KB from
;     $70:6800 to VRAM $4E00 (pause-screen overlay).
;   * else: CODE_bg1_tile_stamp_finaliser/65D/DC6B/DBA9/DC1C (BG3 tilemap stitching, tile
;     animation, BG1 stamping).
;   * update controllers; restore INIDISP/HDMA; re-arm next IRQ.
; Raidenthequick: CODE_irq_normal_level_mode.
;-------------------------------------------------------------------------
CODE_00C48D:
CODE_irq_normal_level_mode:                        ; Raidenthequick: CODE_irq_normal_level_mode
	LDA.w $011B
	BNE.b CODE_00C495
	JMP.w CODE_00C6CC

CODE_00C495:
	REP.b #$20
	LDA.b !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w $0CB0
	STA.w $011F
	LDA.b !RAM_YI_Global_Layer1XPosLo
CODE_00C4A2:
	STA.w $011D
	SEP.b #$20
	STA.w !REGISTER_BG1VertScrollOffset
	XBA
	STA.w !REGISTER_BG1VertScrollOffset
	STZ.w $011B
	JSR.w CODE_process_vram_dma_queue
	JSR.w CODE_prepare_tilemap_dma_queue
	REP.b #$20
	PHD
	LDA.w #!REGISTER_DMAEnable
	TCD
	LDX.b #$01
	JSR.w CODE_process_multi_wram_dma_queue
	JSR.w CODE_00D4AC
	JSR.w CODE_00D4E5
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	LDY.w !RAM_YI_Level_CurrentPauseScreenState
	BEQ.b CODE_00C4F4
	CPY.b #$0C
	BCC.b CODE_00C4F4
	LDA.w #$4E00
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$706800
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #$706800>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$0C00
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	BRA.b CODE_00C50E

CODE_00C4F4:
	JSR.w CODE_bg1_tile_stamp_finaliser
	JSR.w CODE_animate_bg_tilesets
	JSR.w CODE_bg3_tilemap_flush
	LDY.w $0D15
	BEQ.b CODE_00C508
	JSR.w CODE_pause_overlay_tilemap_flush
	STZ.w $0D15
CODE_00C508:
	JSR.w CODE_bg3_tilemap_stitch
	JSR.w CODE_queued_vram_4byte_writes
CODE_00C50E:
	PLD
	LDY.w $0D0D
	BNE.b CODE_00C51B
	LDY.w !RAM_YI_Level_LevelHeaderBackgroundColorLo
	CPY.b #$10
	BCC.b CODE_00C539
CODE_00C51B:
	LDA.w $0D0B
	STA.l $7E5D19
	CLC
	ADC.w #$0069
	STA.l $7E5D1C
	LDA.w $0D09
	STA.l $7E5C99
	CLC
	ADC.w #$00D2
	STA.l $7E5C9C
CODE_00C539:
	SEP.b #$20
	LDA.w $011D
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.w $011E
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.w $011F
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.w $0120
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.b !RAM_YI_Global_Layer2XPosLo
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2XPosHi
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosLo
	STA.w !REGISTER_BG2VertScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosHi
	STA.w !REGISTER_BG2VertScrollOffset
	LDA.b !RAM_YI_Global_Layer3XPosLo
	STA.w !REGISTER_BG3HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer3XPosHi
	STA.w !REGISTER_BG3HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer3YPosLo
	STA.w !REGISTER_BG3VertScrollOffset
	LDA.b !RAM_YI_Global_Layer3YPosHi
	STA.w !REGISTER_BG3VertScrollOffset
	JSR.w CODE_00E507
CODE_00C57E:
	REP.b #$20
	LDA.w #!REGISTER_ScreenDisplayRegister
	TCD
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.b !REGISTER_MainScreenLayers
	LDA.w !RAM_YI_Global_MainScreenWindowMask
	STA.b !REGISTER_MainScreenWindowMask
	LDA.w !RAM_YI_Global_BG1And2TileDataDesignation
	STA.b !REGISTER_BG1And2TileDataDesignation
	LDA.w !RAM_YI_Global_BG1AddressAndSize
	STA.b !REGISTER_BG1AddressAndSize
	LDA.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STA.b !REGISTER_BG1And2WindowMaskSettings
	LDA.w !RAM_YI_Global_ColorMathInitialSettings
	STA.b !REGISTER_ColorMathInitialSettings
	LDA.w !RAM_YI_Global_BGWindowLogicSettings
	STA.b !REGISTER_BGWindowLogicSettings
	SEP.b #$20
	LDA.w !RAM_YI_Global_BG3AddressAndSize
	STA.b !REGISTER_BG3AddressAndSize
	LDA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	STA.b !REGISTER_BGModeAndTileSizeSetting
	LDA.w !RAM_YI_Global_MosaicSizeAndBGEnable
	STA.b !REGISTER_MosaicSizeAndBGEnable
	LDA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	STA.b !REGISTER_ObjectAndColorWindowSettings
	REP.b #$20
	LDA.w #DMA[$00].Parameters
	TCD
	LDA.b HDMA[$01].SourceLo
	STA.b HDMA[$01].TableSourceLo
	LDA.b HDMA[$02].SourceLo
	STA.b HDMA[$02].TableSourceLo
	LDA.b HDMA[$03].SourceLo
	STA.b HDMA[$03].TableSourceLo
	LDA.b HDMA[$04].SourceLo
	STA.b HDMA[$04].TableSourceLo
	LDA.b HDMA[$05].SourceLo
	STA.b HDMA[$05].TableSourceLo
	LDA.b HDMA[$06].SourceLo
	STA.b HDMA[$06].TableSourceLo
	LDA.b HDMA[$07].SourceLo
	STA.b HDMA[$07].TableSourceLo
	SEP.b #$20
	LDA.b #$01
	STA.b HDMA[$01].LineCount
	STA.b HDMA[$02].LineCount
	STA.b HDMA[$03].LineCount
	STA.b HDMA[$04].LineCount
	STA.b HDMA[$05].LineCount
	STA.b HDMA[$06].LineCount
	STA.b HDMA[$07].LineCount
	STZ.w $0125
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$06
	JMP.w CODE_set_v_irq

;-------------------------------------------------------------------------
; CODE_irq_offset_per_tile_levels -- VRAM-transfer IRQ used by
; the "offset-per-tile" level modes (1-7 secret, 6-4 spike-ceiling). Sets
; VRAM increment to columns ($80), DMAs $80 bytes from $7E:F2 to VRAM
; $3600 (the per-tile X-offset table the PPU consumes via mode-3 OPT).
; Raidenthequick: CODE_irq_offset_per_tile_levels.
;-------------------------------------------------------------------------
CODE_00C5FE:
CODE_irq_offset_per_tile_levels:                   ; Raidenthequick: CODE_irq_offset_per_tile_levels
	LDA.w $011B
	BNE.b CODE_00C606
	JMP.w CODE_00C6CC

CODE_00C606:
	LDA.b #$80
	STA.w !REGISTER_VRAMAddressIncrementValue
	REP.b #$20
	LDA.w #$3600
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.w #$007EF2
	STA.w DMA[$00].SourceLo
	LDY.b #$007EF2>>16
	STY.w DMA[$00].SourceBank
	LDY.b #$80
	STY.w DMA[$00].SizeLo
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	LDA.w #$0080
	STA.b !RAM_YI_Global_Layer3YPosLo
	STZ.b !RAM_YI_Global_Layer3XPosLo
	LDA.w $7EF0
	STA.w $011F
	LDA.w $7EEE
	JMP.w CODE_00C4A2

;-------------------------------------------------------------------------
; CODE_irq_raphael_the_raven_boss -- VRAM-transfer IRQ for the
; Raphael the Raven Mode-7 boss fight (level mode $09). Pushes the
; per-frame Mode-7 matrix (M7A-D, M7X, M7Y) out to the PPU and dispatches
; the camera-shake offset into BG1V scroll mirror via CODE_00C4A2.
; Raidenthequick: CODE_irq_raphael_the_raven_boss.
;-------------------------------------------------------------------------
CODE_00C641:
CODE_irq_raphael_the_raven_boss:                   ; Raidenthequick: CODE_irq_raphael_the_raven_boss
	LDA.w $011B
	BNE.b CODE_00C649
	JMP.w CODE_00C6CC

CODE_00C649:
	LDA.w !RAM_YI_Global_Mode7TilemapSettings
	STA.w !REGISTER_Mode7TilemapSettings
	LDA.w !RAM_YI_Global_Mode7MatrixParameterALo
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.w !RAM_YI_Global_Mode7MatrixParameterAHi
	STA.w !REGISTER_Mode7MatrixParameterA
	LDA.w !RAM_YI_Global_Mode7MatrixParameterBLo
	STA.w !REGISTER_Mode7MatrixParameterB
	LDA.w !RAM_YI_Global_Mode7MatrixParameterBHi
	STA.w !REGISTER_Mode7MatrixParameterB
	LDA.w !RAM_YI_Global_Mode7MatrixParameterCLo
	STA.w !REGISTER_Mode7MatrixParameterC
	LDA.w !RAM_YI_Global_Mode7MatrixParameterCHi
	STA.w !REGISTER_Mode7MatrixParameterC
	LDA.w !RAM_YI_Global_Mode7MatrixParameterDLo
	STA.w !REGISTER_Mode7MatrixParameterD
	LDA.w !RAM_YI_Global_Mode7MatrixParameterDHi
	STA.w !REGISTER_Mode7MatrixParameterD
	LDA.w !RAM_YI_Global_Mode7CenterXLo
	STA.w !REGISTER_Mode7CenterX
	LDA.w !RAM_YI_Global_Mode7CenterXHi
	STA.w !REGISTER_Mode7CenterX
	LDA.w !RAM_YI_Global_Mode7CenterYLo
	STA.w !REGISTER_Mode7CenterY
	LDA.w !RAM_YI_Global_Mode7CenterYHi
	STA.w !REGISTER_Mode7CenterY
	REP.b #$20
	LDA.w $0B83
	STA.l $7E51E5
	STA.l $7E51E8
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.l $7E51EB
	LDA.b !RAM_YI_Global_Layer1XPosLo
	STA.b !RAM_YI_Global_Layer2XPosLo
	LDA.b !RAM_YI_Global_Layer1YPosLo
	CLC
	ADC.w $0CB0
	STA.b !RAM_YI_Global_Layer2YPosLo
	LDA.b !RAM_YI_Global_Layer3YPosLo
	LDY.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CPY.b #$09
	BNE.b CODE_00C6C4
	CLC
	ADC.w $0CB0
CODE_00C6C4:
	STA.w $011F
	LDA.b !RAM_YI_Global_Layer3XPosLo
	JMP.w CODE_00C4A2

CODE_00C6CC:
	LDA.w $0121
	BEQ.b CODE_00C6F9
	REP.b #$20
	PHD
	LDA.w #!REGISTER_DMAEnable
	TCD
	LDX.b #$01
	JSR.w CODE_process_multi_wram_dma_queue
	JSR.w CODE_00D4AC
	JSR.w CODE_00D4E5
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	JSR.w CODE_bg1_tile_stamp_finaliser
	JSR.w CODE_bg3_tilemap_flush
	PLD
	SEP.b #$20
	JSR.w CODE_00E507
CODE_00C6F9:
	LDA.w $011D
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.w $011E
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.w $011F
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.w $0120
	STA.w !REGISTER_BG1VertScrollOffset
	JMP.w CODE_00C57E

; DATA_level_intro_irq_routines -- 2-entry dispatch invoked from
; irq_1 when stage-intro flag $0121 is non-zero. $00 = no-op (RTS),
; $02 = JSL into level-name-overlay update (CODE_00C71E -> SuperFX-driven
; level-name tilemap stamp).
DATA_00C714:
DATA_level_intro_irq_routines:
	dw CODE_00C718                            ; $00 no-op
	dw CODE_00C719                            ; $02 update level-name overlay

CODE_00C718:
	RTS

CODE_00C719:
	JSL.l CODE_00C71E
	RTS

CODE_00C71E:
	JSL.l CODE_init_oam_buffer
	JSL.l CODE_0394D3
	JSL.l CODE_04FA67
	JSL.l CODE_04DD9E
	JSL.l CODE_handle_sprites
	REP.b #$20
	LDX.b #FXCODE_08B1EF>>16
	LDA.w #FXCODE_08B1EF
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	INC.w $0D23
	INC.w $0D25
	LDA.w $0D25
	CMP.w #$0010
	BCC.b CODE_00C775
	LDA.w $093E
	ORA.w $0942
	BEQ.b CODE_00C75D
	LDA.w $0D23
	CLC
	ADC.w #$0006
	STA.w $0D23
CODE_00C75D:
	LDA.w $0D25
	AND.w #$0003
	BEQ.b CODE_00C769
	JML.l CODE_00C7C8

CODE_00C769:
	REP.b #$10
	LDX.w #$0000
	LDY.w !RAM_YI_Level_CurrentLevelFromMapLo
	JML.l CODE_render_stage_intro_level_name

CODE_00C775:
	SEP.b #$20
	RTL

;---------------------------------------------------------------------------
; CODE_render_stage_intro_level_name -- per-frame chunk of the stage-intro "level-name overlay"
; renderer. Sets up the SuperFX call to FXCODE_09E92F with R0:R10 pointing
; at the level-name string pointer table (FXDATA_5149BC = the 72-entry
; per-level-ID dw-ptrs table in Bank51), R14 = current level ID (so the
; GSU picks the right string), R11 = LINK destination + state byte
; ($0D21), R8/R9 = vertical / horizontal scratch positions ($0D1F /
; $0D1D). Called once per frame from CODE_00C71E while $0121 (stage-intro
; flag) is non-zero and $0D25's low-2 bits are clear.
;---------------------------------------------------------------------------

CODE_00C778:
CODE_render_stage_intro_level_name:                                  ; descriptive alias
	REP.b #$20
	PHB
	PHK
	PLB
	LDA.w $0D21
	AND.w #$003F
	STA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	STY.w !REGISTER_SuperFX_R14_GETGamePakROMAddressPtrLo
	LDA.w #FXDATA_5149BC>>16
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w #FXDATA_5149BC
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	SEP.b #$10
	LDA.w $0D1D
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w $0D1F
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDX.b #FXCODE_09E92F>>16
	LDA.w #FXCODE_09E92F
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt
	LDA.w !REGISTER_SuperFX_R11_LINKDestinationLo
	STA.w $0D21
	LDA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	STA.w $0D1F
	LDA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	STA.w $0D1D
	INC.w $0CF9
	PLB
	LDA.w #$5038
	STA.w $0D1B
CODE_00C7C8:
	REP.b #$10
	LDA.w #$AAAA
	STA.w $6C00
	STA.w $6C02
	LDA.w #$00E0
	STA.w $0D19
	SEP.b #$20
	LDX.w #$0000
CODE_00C7DE:
	REP.b #$20
	TXA
	AND.w #$00FF
	LSR
	ORA.w #$35C0
	STA.w $6A02,x
	ORA.w #$0020
	STA.w $6A22,x
	LDA.w $0B4C
	SEC
	SBC.w $0D19
	SEP.b #$20
	STA.w $6A00,x
	STA.w $6A20,x
	LDA.w $0D19
	SEC
	SBC.b #$10
	STA.w $0D19
	LDA.w $0D1B
	STA.w $6A01,x
	LDA.w $0D1C
	STA.w $6A21,x
	INX
	INX
	INX
	INX
	CPX.w #$0020
	BCC.b CODE_00C7DE
	SEP.b #$10
	RTL

;-------------------------------------------------------------------------
; CODE_irq_story_cutscene -- alternative IRQ-kind for story
; cutscenes ($0126 == $02). Three-phase H/V-IRQ stepping similar to
; CODE_irq_default, but the V-IRQ values are different ($0E and $C6) to match
; the cutscene's letterbox window. IRQ-2 dispatches via DATA_irq_vram_tx_routines
; same as CODE_irq_default.
;-------------------------------------------------------------------------
CODE_00C821:
CODE_irq_story_cutscene:                           ; Raidenthequick: CODE_irq_story_cutscene
	LDA.w $0125
	BNE.b CODE_00C842
CODE_00C826:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_00C826
CODE_00C82B:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_00C82B
	LDA.w !RAM_YI_Global_HDMAEnable
	STA.w !REGISTER_HDMAEnable
	STZ.w !REGISTER_ScreenDisplayRegister
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$0E
	BRA.b CODE_00C85C

CODE_00C842:
	DEC
	BNE.b CODE_00C862
CODE_00C845:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_00C845
CODE_00C84A:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_00C84A
	LDA.w $0200
	STA.w !REGISTER_ScreenDisplayRegister
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$C6
CODE_00C85C:
	INC.w $0125
	JMP.w CODE_set_v_irq

CODE_00C862:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_00C862
CODE_00C867:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_00C867
	LDY.b #$8F
	STY.w !REGISTER_ScreenDisplayRegister
	STZ.w !REGISTER_HDMAEnable
	LDX.w $011C
	JMP.w (DATA_irq_vram_tx_routines,x)

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_irq_story_cutscene_credits -- VRAM-transfer IRQ for
; cutscene / credits scenes. Does the OAM + COLDATA + tilemap DMA chain
; just like CODE_irq_normal_level_mode but with credits-specific tile-animation
; routines (CODE_00D510 vs CODE_animate_bg_tilesets) and a slightly different scroll
; layout (uses $0CB0 for credits Y-offset).
;-------------------------------------------------------------------------
CODE_00C87A:
CODE_irq_story_cutscene_credits:                   ; Raidenthequick: CODE_irq_story_cutscene_credits
	LDA.w $011B
	BNE.b CODE_00C882
	JMP.w CODE_00CA10

CODE_00C882:
	STZ.w $011B
	JSR.w CODE_process_vram_dma_queue
	JSR.w CODE_prepare_tilemap_dma_queue
	REP.b #$20
	PHD
	LDA.w #!REGISTER_DMAEnable
	TCD
	LDX.b #$01
	JSR.w CODE_process_multi_wram_dma_queue
	JSR.w CODE_00D4AC
	JSR.w CODE_00D4E5
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	LDA.w $0D15
	BEQ.b CODE_00C8C5
	LDA.w #$7000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$704C00
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #$704C00>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$0800
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	STZ.w $0D15
CODE_00C8C5:
	LDA.w $0CF9
	BEQ.b CODE_00C8E0
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDA.w #$5000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$705800
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #$705800>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	STX.b $00
	STZ.w $0CF9
CODE_00C8E0:
	LDA.w $0B85
	BNE.b CODE_00C8E8
	JMP.w CODE_00C9BA

CODE_00C8E8:
	LDA.w #$5400
	STA.w !REGISTER_VRAMAddressLo
	LDY.b #$40
	LDA.w $6128
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #FXDATA_53C000>>16
	STA.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $612C
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $6130
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $6134
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $6138
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $613C
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $6140
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $6144
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w #$5500
	STA.w !REGISTER_VRAMAddressLo
	SEP.b #$20
	LDA.w $6128
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $612B
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $612C
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $612F
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $6130
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $6133
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $6134
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $6137
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $6138
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $613B
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $613C
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $613F
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $6140
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $6143
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	LDA.w $6144
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $6147
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	REP.b #$20
	STZ.w $0B85
CODE_00C9BA:
	PLD
	SEP.b #$20
	JSR.w CODE_00E507
	LDA.b !RAM_YI_Global_Layer1XPosLo
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer1XPosHi
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.b !RAM_YI_Global_Layer1YPosHi
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.b !RAM_YI_Global_Layer2XPosLo
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2XPosHi
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosLo
	STA.w !REGISTER_BG2VertScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosHi
	STA.w !REGISTER_BG2VertScrollOffset
	LDA.b !RAM_YI_Global_Layer3XPosLo
	STA.w !REGISTER_BG3HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer3XPosHi
	STA.w !REGISTER_BG3HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer3YPosLo
	STA.w !REGISTER_BG3VertScrollOffset
	LDA.b !RAM_YI_Global_Layer3YPosHi
	STA.w !REGISTER_BG3VertScrollOffset
	LDA.b !RAM_YI_Global_Layer4XPosLo
	STA.w !REGISTER_BG4HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer4XPosHi
	STA.w !REGISTER_BG4HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer4YPosLo
	STA.w !REGISTER_BG4VertScrollOffset
	LDA.b !RAM_YI_Global_Layer4YPosHi
	STA.w !REGISTER_BG4VertScrollOffset
CODE_00CA10:
	LDA.w !RAM_YI_Global_OAMSizeAndDataAreaDesignation
	STA.w !REGISTER_OAMSizeAndDataAreaDesignation
	LDA.w !RAM_YI_Global_BG1AddressAndSize
	STA.w !REGISTER_BG1AddressAndSize
	LDA.w !RAM_YI_Global_BG2AddressAndSize
	STA.w !REGISTER_BG2AddressAndSize
	LDA.w !RAM_YI_Global_ColorMathInitialSettings
	STA.w !REGISTER_ColorMathInitialSettings
	LDA.w !RAM_YI_Global_ColorMathSelectAndEnable
	STA.w !REGISTER_ColorMathSelectAndEnable
	LDA.w !RAM_YI_Global_MosaicSizeAndBGEnable
	STA.w !REGISTER_MosaicSizeAndBGEnable
	REP.b #$20
	LDA.w $1407
	STA.l $7E5B99
	STA.l $7E5B9C
	LDA.w #DMA[$00].Parameters
	TCD
	LDA.b HDMA[$01].SourceLo
	STA.b HDMA[$01].TableSourceLo
	LDA.b HDMA[$02].SourceLo
	STA.b HDMA[$02].TableSourceLo
	LDA.b HDMA[$03].SourceLo
	STA.b HDMA[$03].TableSourceLo
	LDA.b HDMA[$04].SourceLo
	STA.b HDMA[$04].TableSourceLo
	LDA.b HDMA[$05].SourceLo
	STA.b HDMA[$05].TableSourceLo
	LDA.b HDMA[$06].SourceLo
	STA.b HDMA[$06].TableSourceLo
	LDA.b HDMA[$07].SourceLo
	STA.b HDMA[$07].TableSourceLo
	SEP.b #$20
	LDA.b #$01
	STA.b HDMA[$01].LineCount
	STA.b HDMA[$02].LineCount
	STA.b HDMA[$03].LineCount
	STA.b HDMA[$04].LineCount
	STA.b HDMA[$05].LineCount
	STA.b HDMA[$06].LineCount
	STA.b HDMA[$07].LineCount
	STZ.w $0125
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$0C
	JMP.w CODE_set_v_irq

;---------------------------------------------------------------------------

DATA_00CA80:
	dw $2000,$2000,$1000,$3000,$0000,$4000

DATA_00CA8C:
	dw $7F96DE,$7F56DE,$7F76DE,$7F76DE,$7F56DE,$7F96DE

DATA_00CA98:
	db $50,$52

;-------------------------------------------------------------------------
; CODE_irq_credits -- alternative IRQ-kind for the credits roll
; ($0126 == $04). Uses DATA_00CA80 (VRAM dest table) and DATA_00CA8C (src
; long-address table) to DMA in the next "tile column" of credits text
; per frame, swapping the BG1NBA setting per frame (DATA_00CA98) to
; double-buffer character data.
;-------------------------------------------------------------------------
CODE_00CA9A:
CODE_irq_credits:                                  ; Raidenthequick: CODE_irq_credits
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_irq_credits
CODE_00CA9F:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_00CA9F
	LDA.b #$8F
	STA.w !REGISTER_ScreenDisplayRegister
	JSR.w CODE_00D4C3
	LDA.w $0069
	BEQ.b CODE_00CAF7
	ASL
	ORA.w $006D
	ASL
	TAX
	REP.b #$20
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.l !RAM_YI_Global_DATA_00CA80-$04,x
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.w DMA[$00].Parameters
	LDA.l !RAM_YI_Global_DATA_00CA8C-$04,x
	STA.w DMA[$00].SourceLo
	LDA.w #$2000
	STA.w DMA[$00].SizeLo
	LDY.b #$7F56DE>>16
	STY.w DMA[$00].SourceBank
	LDY.b #$01
	STY.w !REGISTER_DMAEnable
	SEP.b #$20
	DEC.w $0069
	BNE.b CODE_00CAFC
	LDX.b $6D
	LDA.l !RAM_YI_Global_DATA_00CA98,x
	STA.w !REGISTER_BG1And2TileDataDesignation
	TXA
	EOR.b #$01
	STA.b $6D
CODE_00CAF7:
	LDA.w $011B
	BNE.b CODE_00CB14
CODE_00CAFC:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_00CAFC
CODE_00CB01:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_00CB01
	LDA.w $0200
	STA.w !REGISTER_ScreenDisplayRegister
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	JMP.w CODE_00CB97

CODE_00CB14:
	STZ.w $011B
	REP.b #$20
	LDA.w #!REGISTER_DMAEnable
	TCD
	LDX.b #$06
CODE_00CB1F:
	LDA.w $0B93,x
	STA.l $7017C2,x
	LDA.w $0B9B,x
	STA.l $7017E2,x
	DEX
	DEX
	BPL.b CODE_00CB1F
	LDX.b #$01
	JSR.w CODE_00D52B
	LDA.w $0BD3
	BEQ.b CODE_00CB5B
	LDA.w $0BD5
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	LDA.w #$701C00
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #$701C00>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w $0BD7
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDY.b #$01
	STY.b $00
	STZ.w $0BD3
CODE_00CB5B:
	LDA.w #$0000
	TCD
	SEP.b #$20
	JSR.w CODE_00E507
	LDA.w $0200
	STA.w !REGISTER_ScreenDisplayRegister
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	LDA.w $006B
	BEQ.b CODE_00CB97
	STZ.w $006B
	STA.w $0069
	REP.b #$20
	LDA.w #$7F56DE
	STA.b $20
	LDY.b #$7F56DE>>16
	STY.b $22
	LDA.w #$701C00
	STA.b $23
	LDY.b #$701C00>>16
	STY.b $25
	LDA.w #$6000
	JSL.l CODE_dma_wram_gen_purpose
	SEP.b #$20
CODE_00CB97:
	REP.b #$20
	LDA.b $00
	PHA
	LDX.w $0B8F
	LDA.w $0B93
	CLC
	ADC.l !RAM_YI_Global_DATA_00CC58,x
	BMI.b CODE_00CBB5
	STA.w $0B93
	STA.w $0B97
	STA.w $0B9D
	STA.w $0B9F
CODE_00CBB5:
	LDX.b #$00
	LDA.w #$F080
CODE_00CBBA:
	STA.w $096D,x
	STZ.w $096F,x
	STA.w $0A6D,x
	STZ.w $0A6F,x
	DEX
	DEX
	DEX
	DEX
	BNE.b CODE_00CBBA
	LDA.w $0B8D
	ASL
	TAX
	LDA.l !RAM_YI_Global_DATA_00D2C2,x
	STA.b $00
	LDA.w #$007E
	STA.b $02
	REP.b #$10
	LDX.w #$0000
	TXY
CODE_00CBE2:
	REP.b #$20
	LDA.b [$00],y
	STA.b $0A
	INY
	INY
	SEP.b #$20
CODE_00CBEC:
	LDA.b [$00],y
	CMP.b #$FF
	BEQ.b CODE_00CC31
	PHA
	AND.b #$EF
	STA.w $096F,x
	ORA.b #$10
	STA.w $0973,x
	PLA
	AND.b #$10
	LSR
	LSR
	LSR
	ORA.b #$3D
	STA.w $0970,x
	STA.w $0974,x
	LDA.b $0A
	STA.w $096D,x
	STA.w $0971,x
	INY
	CLC
	ADC.b [$00],y
	STA.b $0A
	LDA.b $0B
	STA.w $096E,x
	CLC
	ADC.b #$08
	STA.w $0972,x
	REP.b #$20
	TXA
	CLC
	ADC.w #$0008
	TAX
	INY
	SEP.b #$20
	BRA.b CODE_00CBEC

CODE_00CC31:
	INY
	LDA.b [$00],y
	BEQ.b CODE_00CC50
	INY
	DEC
	BEQ.b CODE_00CBE2
	DEC
	BEQ.b CODE_00CC46
	LDA.b $0A
	CLC
	ADC.b #$08
	STA.b $0A
	BRA.b CODE_00CBEC

CODE_00CC46:
	LDA.b [$00],y
	CLC
	ADC.b $0B
	STA.b $0B
	INY
	BRA.b CODE_00CBEC

CODE_00CC50:
	REP.b #$20
	PLA
	STA.b $00
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

DATA_00CC58:
	dw $F7BE,$0842

DATA_00CC5C:
	dw $A857,$08DA,$08B5,$0498,$07B9,$077C,$087A,$08BB
	dw $089E,$07B9,$08BA,$085C,$00FF

DATA_00CC76:
	dw $A449,$08F5,$0878,$089A,$0878,$08BA,$087F,$0C98
	dw $08F5,$077C,$08D9,$08BC,$089A,$0878,$01FF,$B443
	dw $08F5,$089E,$08BA,$087F,$0498,$087F,$0498,$089A
	dw $109E,$08D7,$0878,$089A,$0878,$087E,$089E,$00FF

DATA_00CCB6:
	dw $A449,$08F4,$087F,$0498,$087E,$077C,$077D,$08BC
	dw $089C,$0C98,$08D1,$0498,$089D,$089E,$01FF,$B450
	dw $08D1,$0498,$087B,$077C,$089A,$0C98,$08D4,$089E
	dw $089D,$089D,$089E,$00FF

DATA_00CCEE:
	dw $A849,$08DA,$08F1,$07B9,$089E,$087E,$07B9,$0878
	dw $089C,$089C,$077C,$07B9,$08BA,$085C,$00FF

DATA_00CD0C:
	dw $A44A,$08F5,$089E,$08BA,$087F,$0498,$109E,$06D2
	dw $08BE,$0878,$08BE,$0878,$089A,$0898,$01FF,$B45A
	dw $08D6,$0878,$08BA,$0878,$07B9,$10BC,$08D7,$0498
	dw $0498,$00FF

DATA_00CD40:
	dw $A452,$08D4,$0498,$08D8,$089E,$08BA,$087F,$1098
	dw $08D4,$089E,$087B,$0878,$01FF,$B442,$08F4,$0878
	dw $08BB,$089E,$07B9,$10BC,$08F5,$0878,$089A,$0878
	dw $087F,$0878,$08BB,$0878,$00FF

DATA_00CD7A:
	dw $A449,$08D4,$0878,$08D9,$08BC,$0878,$089A,$0C98
	dw $08D6,$089E,$07B9,$0498,$08BB,$0878,$01FF,$B443
	dw $081A,$08BC,$0498,$087A,$087F,$0C98,$081A,$0878
	dw $089C,$0878,$089C,$089E,$08BB,$089E,$00FF

DATA_00CDB8:
	dw $A438,$08F4,$087F,$0498,$087E,$077C,$087F,$0498
	dw $07B9,$109E,$08D4,$0878,$08BA,$0878,$089C,$0878
	dw $08BB,$08BA,$08BC,$01FF,$B449,$08F4,$087F,$0498
	dw $087E,$077C,$089A,$0C98,$081A,$089E,$08BA,$087F
	dw $0498,$087B,$0878,$00FF

DATA_00CE00:
	dw $A440,$081A,$0878,$08BA,$08BC,$089D,$089E,$07B9
	dw $0C98,$08F5,$0878,$089A,$077C,$08BB,$0878,$089D
	dw $0498,$00FF

DATA_00CE24:
	dw $A83D,$08DA,$08B4,$089E,$08BC,$07B9,$08BA,$0F7C
	dw $08B5,$077C,$08BA,$0498,$087E,$089D,$077C,$07B9
	dw $08BA,$085C,$00FF

DATA_00CE4A:
	dw $A43E,$081A,$0878,$08BA,$08BC,$087F,$0498,$08BA
	dw $1078,$081A,$0878,$089C,$0878,$089C,$08BC,$07B9
	dw $0878,$01FF,$B45A,$08D4,$077C,$089D,$08BB,$1078
	dw $08F6,$08BA,$08BC,$0498,$00FF

DATA_00CE84:
	dw $A442,$081A,$089E,$08BA,$087F,$0498,$087F,$0498
	dw $07B9,$109E,$08D7,$089E,$089C,$089E,$08BB,$089E
	dw $01FF,$B460,$07B6,$0498,$0799,$0C98,$08D7,$089E
	dw $08BB,$089E,$00FF

DATA_00CEBA:
	dw $A83F,$08DA,$08F4,$089E,$08BC,$089D,$107B,$08B4
	dw $089E,$089C,$089F,$089E,$08BA,$077C,$07B9,$085C
	dw $00FF

DATA_00CEDC:
	dw $A45A,$08D4,$089E,$0799,$0C98,$08D4,$089E,$089D
	dw $087B,$089E,$00FF

DATA_00CEF2:
	dw $A830,$08DA,$08B4,$087F,$0878,$07B9,$0878,$087A
	dw $08BB,$077C,$0FB9,$08B5,$077C,$08BA,$0498,$087E
	dw $089D,$077C,$07B9,$08BA,$085C,$00FF

DATA_00CF1E:
	dw $A44E,$08F4,$087F,$0498,$087E,$077C,$077D,$08BC
	dw $089C,$0C98,$08D1,$0498,$089D,$089E,$01FF,$B44C
	dw $08D1,$0498,$08BA,$0878,$08BA,$087F,$0C98,$08D7
	dw $089E,$087E,$0878,$089C,$0498,$00FF

DATA_00CF5A:
	dw $A44A,$08D6,$0878,$08BA,$0878,$087F,$0498,$07B9
	dw $109E,$06D2,$0498,$089C,$08BC,$07B9,$0878,$01FF
	dw $B445,$08F5,$089E,$089C,$089E,$0878,$089A,$0C98
	dw $08D4,$08BC,$07B9,$089E,$08BC,$089C,$077C,$00FF

DATA_00CF9A:
	dw $A84B,$08DA,$08B4,$08DB,$08D0,$08DB,$08B5,$077C
	dw $08BA,$0498,$087E,$089D,$077C,$07B9,$085C,$00FF

DATA_00CFBA:
	dw $A448,$081A,$089E,$08BA,$087F,$0498,$0878,$089A
	dw $0C98,$08D4,$089E,$0498,$08D9,$08BC,$089C,$0498
	dw $00FF

DATA_00CFDC:
	dw $A838,$08DA,$08F4,$089F,$077C,$087A,$0498,$0878
	dw $0C9B,$08F5,$087F,$0878,$089D,$089A,$10BA,$08F5
	dw $089E,$085C,$00FF

DATA_00D002:
	dw $A443,$0818,$0878,$08BB,$0878,$07B9,$10BC,$081A
	dw $0878,$089C,$0878,$087E,$08BC,$087A,$087F,$0498
	dw $01FF,$B445,$081A,$089E,$08BA,$087F,$0498,$089A
	dw $0C98,$08D1,$0878,$07B9,$08BC,$087F,$0878,$089D
	dw $0878,$00FF

DATA_00D046:
	dw $A450,$081A,$089E,$0498,$087A,$087F,$0C98,$08D4
	dw $089E,$08BB,$0878,$0879,$077C,$01FF,$B44B,$081A
	dw $0878,$08BA,$08BC,$087F,$0498,$07B9,$109E,$08F4
	dw $0878,$089A,$0878,$0498,$00FF

DATA_00D080:
	dw $A44B,$08D1,$0498,$07B9,$089E,$089D,$089E,$0879
	dw $10BC,$08D4,$0878,$089A,$08BC,$0498,$01FF,$B440
	dw $08F4,$087F,$0498,$087E,$077C,$089A,$0C98,$081A
	dw $0878,$089C,$0878,$08BA,$087F,$0498,$07B9,$089E
	dw $00FF

DATA_00D0C2:
	dw $A44C,$08D4,$0498,$089C,$0498,$08D8,$089E,$08BA
	dw $087F,$0C98,$07B7,$08BC,$089A,$08BC,$0498,$01FF
	dw $B45B,$08D4,$077C,$0498,$08D9,$109E,$08D4,$0878
	dw $08BB,$089E,$00FF

DATA_00D0F8:
	dw $A449,$08F4,$089E,$0498,$087A,$087F,$0498,$07B9
	dw $109E,$08F5,$089E,$089C,$0498,$08BB,$0878,$01FF
	dw $B44F,$08D6,$0498,$0F7C,$081A,$089E,$08BA,$087F
	dw $0498,$089C,$08BC,$07B9,$0878,$00FF

DATA_00D134:
	dw $A449,$08D4,$077C,$089D,$08BA,$08BC,$089A,$0F7C
	dw $08F5,$0878,$089D,$0878,$0879,$077C,$01FF,$B445
	dw $08F5,$077C,$08BB,$08BA,$10BC,$08D1,$0878,$08BA
	dw $087F,$0498,$089C,$089E,$08BB,$089E,$00FF

DATA_00D172:
	dw $A451,$08B5,$077C,$07B9,$077C,$0F9A,$0818,$087F
	dw $0498,$089F,$089F,$049B,$077C,$01FF,$B457,$08D1
	dw $0498,$07B9,$109E,$081A,$0878,$089C,$0878,$087B
	dw $0878,$00FF

DATA_00D1A6:
	dw $A858,$08DA,$08F1,$07B9,$089E,$087B,$08BC,$087A
	dw $077C,$07B9,$085C,$00FF

DATA_00D1BE:
	dw $A443,$08F4,$087F,$0498,$087E,$077C,$07B9,$10BC
	dw $08D6,$0498,$08D8,$0878,$089C,$089E,$08BB,$089E
	dw $00FF

DATA_00D1E0:
	dw $A834,$08DA,$07B6,$08BF,$077C,$087A,$08BC,$08BB
	dw $0498,$08BD,$0F7C,$08F1,$07B9,$089E,$087B,$08BC
	dw $087A,$077C,$07B9,$085C,$00FF

DATA_00D20A:
	dw $A446,$08D1,$0498,$07B9,$089E,$08BA,$087F,$0C98
	dw $081A,$0878,$089C,$0878,$08BC,$087A,$087F,$0498
	dw $00FF

DATA_00D22C:
	dw $A41E,$07D5,$089E,$089E,$089A,$10BA,$049B,$0498
	dw $089A,$0F7C,$08BB,$087F,$077C,$10D8,$087F,$0878
	dw $08BD,$0F7C,$0878,$07B9,$07B9,$0498,$08BD,$077C
	dw $087B,$01FF,$B424,$08BE,$087F,$077C,$07B9,$0F7C
	dw $089C,$089E,$109C,$0878,$089D,$107B,$087B,$0878
	dw $107B,$049B,$0498,$08BD,$077C,$08DB,$08DB,$08DB
	dw $08DB,$00FF

DATA_00D290:
	dw $A442,$08D1,$077C,$07B9,$089E,$077C,$10BA,$0878
	dw $07B9,$0F7C,$0879,$089E,$07B9,$089D,$081F,$081F
	dw $00FF

DATA_00D2B2:
	dw $A462,$08F5,$08D1,$0FB6,$07B6,$08D7,$08B5,$00FF

DATA_00D2C2:
	dw DATA_00CC5C,DATA_00CC5C,DATA_00CC76,DATA_00CCB6,DATA_00CCEE,DATA_00CD0C,DATA_00CD40,DATA_00CD7A
	dw DATA_00CDB8,DATA_00CE00,DATA_00CE24,DATA_00CE4A,DATA_00CE84,DATA_00CEBA,DATA_00CEDC,DATA_00CEF2
	dw DATA_00CF1E,DATA_00CF5A,DATA_00CF9A,DATA_00CFBA,DATA_00CFDC,DATA_00D002,DATA_00D046,DATA_00D080
	dw DATA_00D0C2,DATA_00D0F8,DATA_00D134,DATA_00D172,DATA_00D1A6,DATA_00D1BE,DATA_00D1E0,DATA_00D20A
	dw DATA_00D22C,DATA_00D290,DATA_00D2B2

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_irq_bonus_game -- alternative IRQ-kind for the bonus
; mini-games / bandit games ($0126 == $06). Same 3-step "force-blank /
; restore / vram-transfer" pattern as CODE_irq_default but with bonus-mode-
; specific VRAM updates and an extended per-frame register copy chain
; (BG/window/colormath mirrors at $D420-$D465). H/V values: $50 / $08
; ($V=$08 for IRQ0), $50 / $D8 ($V=$D8 for IRQ1), then $50 / $06 to
; re-arm next frame.
; Raidenthequick: CODE_irq_bonus_game.
;-------------------------------------------------------------------------
CODE_00D308:
CODE_irq_bonus_game:                               ; Raidenthequick: CODE_irq_bonus_game
	LDA.w $0125
	BNE.b CODE_00D329
CODE_00D30D:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_00D30D
CODE_00D312:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_00D312
	LDA.w !RAM_YI_Global_HDMAEnable
	STA.w !REGISTER_HDMAEnable
	STZ.w !REGISTER_ScreenDisplayRegister
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$08
	BRA.b CODE_00D343

CODE_00D329:
	DEC
	BNE.b CODE_00D34F
CODE_00D32C:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_00D32C
CODE_00D331:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_00D331
	LDA.w $0200
	STA.w !REGISTER_ScreenDisplayRegister
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$D8
CODE_00D343:
	INC.w $0125
CODE_00D346:
	STA.w !REGISTER_VCountTimerLo
	LDA.b #$B1
	STA.w !REGISTER_IRQNMIAndJoypadEnableFlags
	RTS

CODE_00D34F:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVS.b CODE_00D34F
CODE_00D354:
	BIT.w !REGISTER_HVBlankFlagsAndJoypadStatus
	BVC.b CODE_00D354
	LDY.b #$8F
	STY.w !REGISTER_ScreenDisplayRegister
	STZ.w !REGISTER_HDMAEnable
	LDA.w $011B
	BNE.b CODE_00D369
	JMP.w CODE_00D46B

CODE_00D369:
	STZ.w $011B
	JSR.w CODE_process_vram_dma_queue
	JSR.w CODE_prepare_tilemap_dma_queue
	REP.b #$20
	PHD
	LDA.w #!REGISTER_DMAEnable
	TCD
	LDX.b #$01
	JSR.w CODE_process_multi_wram_dma_queue
	JSR.w CODE_00D4AC
	JSR.w CODE_00D4E5
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	JSR.w CODE_bg1_tile_stamp_finaliser
	LDY.w $0D15
	BEQ.b CODE_00D39E
	JSR.w CODE_pause_overlay_tilemap_flush
	STZ.w $0D15
	BRA.b CODE_00D3A1

CODE_00D39E:
	JSR.w CODE_bg3_tilemap_flush
CODE_00D3A1:
	LDA.w !RAM_YI_Global_CurrentGameMode
	CMP.w #!Define_YI_GameMode30
	BNE.b CODE_00D3C3
	LDA.w !RAM_YI_Global_HDMAEnable
	AND.w #$0020
	BEQ.b CODE_00D3C0
	LDA.w $10E0
	STA.l $7E5040
	EOR.w #$FFFF
	INC
	STA.l $7E5042
CODE_00D3C0:
	JSR.w CODE_bg3_tilemap_stitch
CODE_00D3C3:
	PLD
	SEP.b #$20
	LDA.b !RAM_YI_Global_Layer1XPosLo
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer1XPosHi
	STA.w !REGISTER_BG1HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer1YPosLo
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.b !RAM_YI_Global_Layer1YPosHi
	STA.w !REGISTER_BG1VertScrollOffset
	LDA.b !RAM_YI_Global_Layer2XPosLo
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2XPosHi
	STA.w !REGISTER_BG2HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosLo
	STA.w !REGISTER_BG2VertScrollOffset
	LDA.b !RAM_YI_Global_Layer2YPosHi
	STA.w !REGISTER_BG2VertScrollOffset
	LDA.b !RAM_YI_Global_Layer3XPosLo
	STA.w !REGISTER_BG3HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer3XPosHi
	STA.w !REGISTER_BG3HorizScrollOffset
	LDA.b !RAM_YI_Global_Layer3YPosLo
	STA.w !REGISTER_BG3VertScrollOffset
	LDA.b !RAM_YI_Global_Layer3YPosHi
	STA.w !REGISTER_BG3VertScrollOffset
	LDA.w !RAM_YI_Global_MainScreenLayers
	STA.w !REGISTER_MainScreenLayers
	LDA.w !RAM_YI_Global_SubScreenLayers
	STA.w !REGISTER_SubScreenLayers
	LDA.w !RAM_YI_Global_MainScreenWindowMask
	STA.w !REGISTER_MainScreenWindowMask
	LDA.w !RAM_YI_Global_SubScreenWindowMask
	STA.w !REGISTER_SubScreenWindowMask
	LDA.w !RAM_YI_Global_BG1And2TileDataDesignation
	STA.w !REGISTER_BG1And2TileDataDesignation
	LDA.w !RAM_YI_Global_BG1AddressAndSize
	STA.w !REGISTER_BG1AddressAndSize
	LDA.w !RAM_YI_Global_BGModeAndTileSizeSetting
	STA.w !REGISTER_BGModeAndTileSizeSetting
	LDA.w !RAM_YI_Global_BG1And2WindowMaskSettings
	STA.w !REGISTER_BG1And2WindowMaskSettings
	LDA.w !RAM_YI_Global_BG3And4WindowMaskSettings
	STA.w !REGISTER_BG3And4WindowMaskSettings
	LDA.w !RAM_YI_Global_ObjectAndColorWindowSettings
	STA.w !REGISTER_ObjectAndColorWindowSettings
	LDA.w !RAM_YI_Global_ColorMathInitialSettings
	STA.w !REGISTER_ColorMathInitialSettings
	LDA.w !RAM_YI_Global_ColorMathSelectAndEnable
	STA.w !REGISTER_ColorMathSelectAndEnable
	LDA.w !RAM_YI_Global_BGWindowLogicSettings
	STA.w !REGISTER_BGWindowLogicSettings
	LDA.w !RAM_YI_Global_ColorAndObjectWindowLogicSettings
	STA.w !REGISTER_ColorAndObjectWindowLogicSettings
	LDA.w !RAM_YI_Global_BG2AddressAndSize
	STA.w !REGISTER_BG2AddressAndSize
	LDA.w !RAM_YI_Global_BG3AddressAndSize
	STA.w !REGISTER_BG3AddressAndSize
	LDA.w !RAM_YI_Global_MosaicSizeAndBGEnable
	STA.w !REGISTER_MosaicSizeAndBGEnable
	JSR.w CODE_00E507
CODE_00D46B:
	REP.b #$20
	LDA.w #DMA[$00].Parameters
	TCD
	LDA.b HDMA[$01].SourceLo
	STA.b HDMA[$01].TableSourceLo
	LDA.b HDMA[$02].SourceLo
	STA.b HDMA[$02].TableSourceLo
	LDA.b HDMA[$03].SourceLo
	STA.b HDMA[$03].TableSourceLo
	LDA.b HDMA[$04].SourceLo
	STA.b HDMA[$04].TableSourceLo
	LDA.b HDMA[$05].SourceLo
	STA.b HDMA[$05].TableSourceLo
	LDA.b HDMA[$06].SourceLo
	STA.b HDMA[$06].TableSourceLo
	LDA.b HDMA[$07].SourceLo
	STA.b HDMA[$07].TableSourceLo
	SEP.b #$20
	LDA.b #$01
	STA.b HDMA[$01].LineCount
	STA.b HDMA[$02].LineCount
	STA.b HDMA[$03].LineCount
	STA.b HDMA[$04].LineCount
	STA.b HDMA[$05].LineCount
	STA.b HDMA[$06].LineCount
	STA.b HDMA[$07].LineCount
	STZ.w $0125
	LDA.b #$50
	STA.w !REGISTER_HCountTimerLo
	LDA.b #$06
	JMP.w CODE_00D346

;---------------------------------------------------------------------------

CODE_00D4AC:
	STZ.w !REGISTER_OAMAddressLo
	STZ.b DMA[$00].Parameters-!REGISTER_DMAEnable
	LDA.w #(!REGISTER_OAMDataWritePort&$0000FF)+(($006A00&$0000FF)<<8)
	STA.b DMA[$00].Destination-!REGISTER_DMAEnable
	LDA.w #$006A00>>8
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	LDA.w #$0220
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	RTS

;---------------------------------------------------------------------------

CODE_00D4C3:
	REP.b #$20
	STZ.w !REGISTER_OAMAddressLo
	STZ.w DMA[$00].Parameters
	LDA.w #(!REGISTER_OAMDataWritePort&$0000FF)+(($00096D&$0000FF)<<8)
	STA.w DMA[$00].Destination
	LDA.w #$00096D>>8
	STA.w DMA[$00].SourceHi
	LDA.w #$0220
	STA.w DMA[$00].SizeLo
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	SEP.b #$20
	RTS

;---------------------------------------------------------------------------

CODE_00D4E5:
	LDA.w $0948
	AND.w #$001F
	ORA.w #$0020
	TAY
	STY.w !REGISTER_FixedColorData
	LDA.w $0948
	LSR
	LSR
	LSR
	LSR
	LSR
	AND.w #$001F
	ORA.w #$0040
	TAY
	STY.w !REGISTER_FixedColorData
	LDA.w $0949
	LSR
	LSR
	ORA.w #$0080
	TAY
	STY.w !REGISTER_FixedColorData
CODE_00D510:
	LDY.b #$00
	STY.w !REGISTER_CGRAMAddress
	LDA.w #((!REGISTER_WriteToCGRAMPort&$0000FF)<<8)+$00
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	LDA.w #$702000
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #$702000>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$0200
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	RTS

;---------------------------------------------------------------------------

CODE_00D52B:
	LDA.w $0948
	AND.w #$001F
	ORA.w #$0020
	TAY
	STY.w !REGISTER_FixedColorData
	LDA.w $0948
	LSR
	LSR
	LSR
	LSR
	LSR
	AND.w #$001F
	ORA.w #$0040
	TAY
	STY.w !REGISTER_FixedColorData
	LDA.w $0949
	LSR
	LSR
	ORA.w #$0080
	TAY
	STY.w !REGISTER_FixedColorData
	LDY.b #$00
	STY.w !REGISTER_CGRAMAddress
	LDA.w #((!REGISTER_WriteToCGRAMPort&$0000FF)<<8)+$00
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	LDA.w #$701600
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #$701600>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$0200
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b $00
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_init_tileset_animation -- called once on level load to
; prime the animated-tile VRAM regions. Sets up the DMA channel (M=16
; control flags, VRAM increment, VRAM-port-low destination), then runs
; CODE_animate_bg_tilesets $20 times to cycle through a full
; animation period -- this guarantees all four sub-frames of every
; animated tile (coins / !-blocks / star blocks / water) are pre-loaded.
; Raidenthequick: CODE_init_tileset_animation.
;
; INPUTS:   none (level header tilesets already loaded).
; OUTPUTS:  VRAM $1400-$14FF (animated tile slots) filled with first
;           4-frame cycle of every active tile; $7974 frame counter primed.
; MODIFIES: DBR/DP pushed; A, X, Y; SuperFX scratch via CODE_animate_bg_tilesets;
;           VRAM $1400-$14FF.
; CALLERS:  level-load chain (Bank01 game-mode $0C/$0E init).
;-------------------------------------------------------------------------
CODE_00D571:
CODE_init_tileset_animation:                       ; Raidenthequick: CODE_init_tileset_animation
	PHB
	PHD
	PHK
	PLB
	REP.b #$20
	LDA.w #!REGISTER_DMAEnable
	TCD
	LDX.b #$01
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	LDA.w #$0020
	STA.w $0000
CODE_00D58D:
	INC.w $7974
	JSR.w CODE_animate_bg_tilesets
	DEC.w $0000
	BNE.b CODE_00D58D
	SEP.b #$20
	PLD
	PLB
	RTL

;---------------------------------------------------------------------------

; DATA_default_tile_anim_vram_ptrs -- 4 rows of 8 VRAM dests
; for the default animated-tile slots: coins ($1400), !-switch blocks
; ($1440), !-switch coins ($1480), Super Mario Star Blocks ($14C0).
; Each slot pair (even=transparent !-blocks, odd=opaque) is rebroadcast
; per frame from the matching DATA_default_tile_anim_source_ptrs source pointers.
DATA_00D59D:
DATA_default_tile_anim_vram_ptrs:                  ; Raidenthequick: DATA_default_tile_anim_vram_ptrs
	dw $1400,$1400,$1440,$1440,$1480,$1480,$14C0,$14C0
	dw $1400,$1400,$1440,$1440,$1480,$1480,$14C0,$14C0
	dw $1400,$1400,$1440,$1440,$1480,$1480,$14C0,$14C0
	dw $1400,$1400,$1440,$1440,$1480,$1480,$14C0,$14C0

; SuperFX-bank source pointers for the default-anim VRAM destinations
; defined just above (32 entries, one per DATA_default_tile_anim_vram_ptrs
; slot). DMA copies $80 bytes from each into the matching VRAM slot.
DATA_00D5DD:
DATA_default_tile_anim_source_ptrs:                ; descriptive alias
	dw FXDATA_520000+$C000,FXDATA_520000+$C000,FXDATA_520000+$C400,FXDATA_520000+$C100,FXDATA_520000+$C500,FXDATA_520000+$C000,FXDATA_520000+$C400,FXDATA_520000+$A880
	dw FXDATA_520000+$C080,FXDATA_520000+$C080,FXDATA_520000+$C480,FXDATA_520000+$C180,FXDATA_520000+$C580,FXDATA_520000+$C080,FXDATA_520000+$C480,FXDATA_520000+$AA80
	dw FXDATA_520000+$C200,FXDATA_520000+$C200,FXDATA_520000+$C600,FXDATA_520000+$C300,FXDATA_520000+$C700,FXDATA_520000+$C200,FXDATA_520000+$C600,FXDATA_520000+$AC80
	dw FXDATA_520000+$C280,FXDATA_520000+$C280,FXDATA_520000+$C680,FXDATA_520000+$C380,FXDATA_520000+$C780,FXDATA_520000+$C280,FXDATA_520000+$C680,FXDATA_520000+$AE80

; Frame-cycle masks parallel to DATA_default_tile_anim_source_ptrs (32
; entries). The animation driver does `LDA $7E08 / AND DATA_..._frame_masks,y`:
; mask $0000 = no animation (slot stays on its base frame), $0008 = 8-frame
; cycle, $0010 = 16-frame cycle. Non-zero result triggers INY/INY (advance
; to the next source/dest pair in the same anim slot).
DATA_00D61D:
DATA_default_tile_anim_frame_masks:                ; descriptive alias
	dw $0000,$0000,$0008,$0000,$0008,$0000,$0010,$0000
	dw $0000,$0000,$0008,$0000,$0008,$0000,$0010,$0000
	dw $0000,$0000,$0008,$0000,$0008,$0000,$0010,$0000
	dw $0000,$0000,$0008,$0000,$0008,$0000,$0010,$0000

;-------------------------------------------------------------------------
; CODE_animate_bg_tilesets -- per-frame BG-tile animation driver.
; Dispatches to DATA_tile_animation_ptrs[header] (18 routines, one per animation-
; tileset header value) which queues the per-frame source pointers for
; coin / !-block / star tiles, then DMAs the default-anim VRAM dest +
; source pair into VRAM. If $0CFB is non-zero, also DMAs in the per-frame
; coin-cycle frames at VRAM $1280 + $1380.
; Raidenthequick: CODE_animate_bg_tilesets.
;-------------------------------------------------------------------------
CODE_00D65D:
CODE_animate_bg_tilesets:                          ; Raidenthequick: CODE_animate_bg_tilesets
	LDA.w !EXRAM_YI_Level_FreezeSpritesFlagLo|!EXRAMBankMirror
	BNE.b CODE_00D665
	INC.w $0B6D
CODE_00D665:
	LDA.w !RAM_YI_Level_LevelHeaderAnimationTilesetLo
	ASL
	TAX
	JSR.w (DATA_tile_animation_ptrs,x)
	LDA.w $7974
	AND.w #$001E
	ASL
	TAY
	LDA.w $7E08
	AND.w DATA_default_tile_anim_frame_masks,y
	BEQ.b CODE_00D67F
	INY
	INY
CODE_00D67F:
	LDA.w DATA_default_tile_anim_vram_ptrs,y
	STA.w !REGISTER_VRAMAddressLo
CODE_00D685:
	LDA.w DATA_default_tile_anim_source_ptrs,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #(FXDATA_520000+$C000)>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDY.b #$80
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $0CFB
	BEQ.b CODE_00D6C1
	LDA.w #$1280
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$7060C0
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #$7060C0>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDA.w #$1380
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$7062C0
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	STZ.w $0CFB
CODE_00D6C1:
	RTS

;-------------------------------------------------------------------------
; DATA_tile_animation_ptrs -- 18-entry word table indexed by
; !RAM_YI_Level_LevelHeaderAnimationTilesetLo. Each handler queues the
; per-frame source pointers for that level's specific tile-animation set
; (water, smiley clouds, lava, torches, butterfly, etc).
; Raidenthequick: DATA_tile_animation_ptrs (entries CODE_tile_animation_00..11).
;-------------------------------------------------------------------------
DATA_00D6C2:
DATA_tile_animation_ptrs:                          ; Raidenthequick: DATA_tile_animation_ptrs
	dw CODE_tile_animation_00                            ; $00 default CODE_tile_animation_00
	dw CODE_tile_animation_01                            ; $01 CODE_tile_animation_01
	dw CODE_tile_animation_02                            ; $02 CODE_tile_animation_02 (water)
	dw CODE_tile_animation_03                            ; $03 CODE_tile_animation_03 (smiley clouds)
	dw CODE_tile_animation_no_op                            ; $04 tile_animation_04 (no-op fallback)
	dw CODE_tile_animation_05                            ; $05 CODE_tile_animation_05
	dw CODE_tile_animation_06                            ; $06 CODE_tile_animation_06
	dw CODE_tile_animation_07                            ; $07 CODE_tile_animation_07
	dw CODE_tile_animation_08                            ; $08 CODE_tile_animation_08
	dw CODE_tile_animation_09                            ; $09 CODE_tile_animation_09
	dw CODE_00D99C                            ; $0A CODE_tile_animation_0A
	dw CODE_00D9F6                            ; $0B CODE_tile_animation_0B
	dw CODE_00DA65                            ; $0C CODE_tile_animation_0C
	dw CODE_00DAE4                            ; $0D CODE_tile_animation_0D
	dw CODE_00DB06                            ; $0E CODE_tile_animation_0E
	dw CODE_00DB1C                            ; $0F CODE_tile_animation_0F
	dw CODE_tile_animation_10                            ; $10 CODE_tile_animation_10
	dw CODE_tile_animation_11                            ; $11 CODE_tile_animation_11

;---------------------------------------------------------------------------

CODE_00D6E6:
CODE_tile_animation_no_op:                         ; entry $04: no-op fallback (PLA discards caller, returns to dispatch parent)
	PLA
	LDX.b #$01
	RTS

;---------------------------------------------------------------------------

CODE_00D6EA:
CODE_tile_animation_00:                            ; default header animation (FXDATA $52:B400 cycle)
	LDA.w $7974
	AND.w #$0007
	XBA
	LSR
	ORA.w #$1000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #FXDATA_520000+$B400
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDX.b #(FXDATA_520000+$B400)>>16
	STX.b $F9
	LDA.w #$0100
	STA.b $FA
	LDX.b #$01
	STX.b $00
	RTS

;---------------------------------------------------------------------------

DATA_00D70B:
	dw DATA_568000+$0800,DATA_568000+$0A00,DATA_568000+$0C00,DATA_568000+$0E00

CODE_00D713:
CODE_tile_animation_01:                            ; 4-frame swap from DATA_568000 $0800/0A00/0C00/0E00 into VRAM $2F00
	LDA.w #$2F00
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0200
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDY.b #(DATA_568000+$0800)>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w $7974
	LSR
	LSR
	AND.w #$0006
	TAY
	LDA.w DATA_00D70B,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDX.b #$01
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	RTS

;---------------------------------------------------------------------------

DATA_00D735:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw $1000,$1080,$1200,$1280

DATA_00D73D:
	dw $1100,$1180,$1300,$1380

DATA_00D745:
	dw FXDATA_520000+$D000,FXDATA_520000+$D800,FXDATA_520000+$C000,FXDATA_520000+$C000,FXDATA_520000+$D200,FXDATA_520000+$DA00,FXDATA_520000+$C000,FXDATA_520000+$C000
	dw FXDATA_520000+$D400,FXDATA_520000+$DC00,FXDATA_520000+$C000,FXDATA_520000+$C000,FXDATA_520000+$D600,FXDATA_520000+$DE00,FXDATA_520000+$C000,FXDATA_520000+$C000

CODE_00D765:
CODE_tile_animation_02:                            ; water animation: cycles 16 frame pairs into VRAM $1000-$1380
	LDA.w $7974
	AND.w #$001E
	TAY
	LDA.w DATA_00D745,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDX.b #(FXDATA_520000+$C000)>>16
	STX.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	TYA
	AND.w #$0006
	TAY
	LDA.w DATA_00D735,y
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDX.b #$01
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDA.w DATA_00D73D,y
	STA.w !REGISTER_VRAMAddressLo
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	RTS

;---------------------------------------------------------------------------

DATA_00D794:
	dw DATA_568000+$1000,DATA_568000+$1000,DATA_568000+$1000,DATA_568000+$1000,DATA_568000+$1200,DATA_568000+$1200,DATA_568000+$1200,DATA_568000+$1200
	dw DATA_568000+$1400,DATA_568000+$1400,DATA_568000+$1400,DATA_568000+$1400,DATA_568000+$1600,DATA_568000+$1600,DATA_568000+$1600,DATA_568000+$1600

CODE_00D7B4:
CODE_tile_animation_03:                            ; smiley clouds: cycles 16 frames into VRAM $2F00
	LDA.w $7974
	AND.w #$000F
	ASL
	TAY
	LDA.w DATA_00D794,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDX.b #(DATA_568000+$1000)>>16
	STX.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$2F00
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0200
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDX.b #$01
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	RTS

;---------------------------------------------------------------------------

DATA_00D7D5:
	dw DATA_568000+$1800,DATA_568000+$1A00,DATA_568000+$1C00,DATA_568000+$1E00,DATA_568000+$2000,DATA_568000+$2200,DATA_568000+$2400,DATA_568000+$2600
	dw DATA_568000+$2400,DATA_568000+$2200,DATA_568000+$2000,DATA_568000+$1E00,DATA_568000+$1C00,DATA_568000+$1A00

CODE_00D7F1:
CODE_tile_animation_05:                            ; 14-step animation with wraparound at $38
	LDA.w $0B67
	INC
	CMP.w #$0038
	BCC.b CODE_00D7FD
	LDA.w #$0000
CODE_00D7FD:
	STA.w $0B67
	LSR
	AND.w #$00FE
	TAY
CODE_00D805:
	LDA.w DATA_00D7D5,y
CODE_00D808:
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDX.b #(DATA_568000+$1800)>>16
	STX.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$2F00
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0200
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDX.b #$01
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	RTS

CODE_00D81E:
CODE_tile_animation_06:                            ; 8-frame cycle, alternates VRAM destination based on level mode
	LDA.w $0B6D
	CMP.w #$0006
	BCC.b CODE_00D834
	STZ.w $0B6D
	LDA.w $0B67
	INC
	INC
	AND.w #$000E
	STA.w $0B67
CODE_00D834:
	LDY.w $0B67
	LDA.w !RAM_YI_Level_LevelHeaderLevelModeLo
	CMP.w #$000A
	BNE.b CODE_00D805
	LDA.w DATA_00D7D5,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDX.b #(DATA_568000+$1800)>>16
	STX.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$7F00
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0200
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDX.b #$01
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	RTS

;---------------------------------------------------------------------------

DATA_00D858:
	dw FXDATA_520000+$C800,FXDATA_520000+$CA00,FXDATA_520000+$CC00,FXDATA_520000+$CE00,FXDATA_520000+$EC00,FXDATA_520000+$EE00,FXDATA_520000+$F000,FXDATA_520000+$F200

DATA_00D868:
	dw FXDATA_520000+$C900,FXDATA_520000+$CB00,FXDATA_520000+$CD00,FXDATA_520000+$CF00,FXDATA_520000+$ED00,FXDATA_520000+$EF00,FXDATA_520000+$F100,FXDATA_520000+$F300

DATA_00D878:
	dw FXDATA_520000+$EC00,FXDATA_520000+$EE00,FXDATA_520000+$F000,FXDATA_520000+$F200,FXDATA_520000+$F400,FXDATA_520000+$F600,FXDATA_520000+$F800,FXDATA_520000+$FA00

DATA_00D888:
	dw FXDATA_520000+$ED00,FXDATA_520000+$EF00,FXDATA_520000+$F100,FXDATA_520000+$F300,FXDATA_520000+$F500,FXDATA_520000+$F700,FXDATA_520000+$F900,FXDATA_520000+$FB00

CODE_00D898:
CODE_tile_animation_07:                            ; 4-frame cycle, two sub-frames per cycle into VRAM $1000-$1180
	LDA.w $0B6D
	CMP.w #$000B
	BCC.b CODE_00D8AD
	STZ.w $0B6D
	LDA.w $0B67
	INC
	AND.w #$0003
	STA.w $0B67
CODE_00D8AD:
	LDA.w $0B67
	ASL
	TAY
	LDX.b #(FXDATA_520000+$C800)>>16
	LDA.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
	CMP.w #$000A
	BNE.b CODE_00D8C3
	TYA
	ORA.w #$0008
	TAY
	LDX.b #(DATA_568000+$4800)>>16
CODE_00D8C3:
	STX.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDX.b #$01
	LDA.w $7974
	AND.w #$0001
	BEQ.b CODE_00D8F6
	LDA.w DATA_00D858,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$1000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.w !REGISTER_DMAEnable
	LDA.w DATA_00D868,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$1100
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.w !REGISTER_DMAEnable
	RTS

CODE_00D8F6:
	LDA.w DATA_00D878,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$1080
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.w !REGISTER_DMAEnable
	LDA.w DATA_00D888,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$1180
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.w !REGISTER_DMAEnable
	RTS

;---------------------------------------------------------------------------

DATA_00D91D:
	dw FXDATA_520000+$E400,FXDATA_520000+$E600,FXDATA_520000+$E800,FXDATA_520000+$EA00

DATA_00D925:
	dw FXDATA_520000+$E500,FXDATA_520000+$E700,FXDATA_520000+$E900,FXDATA_520000+$EB00

CODE_00D92D:
CODE_tile_animation_08:                            ; 4-frame cycle from FXDATA $52:E400 into VRAM $1000/$1100
	INC.w $0B6D
	LDA.w $0B6D
	CMP.w #$0010
	BCC.b CODE_00D945
	STZ.w $0B6D
	LDA.w $0B67
	INC
	AND.w #$0003
	STA.w $0B67
CODE_00D945:
	LDA.w $0B67
	ASL
	TAY
	LDA.w DATA_00D91D,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDX.b #(FXDATA_520000+$E400)>>16
	STX.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$1000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	LDA.w DATA_00D925,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$1100
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.w !REGISTER_DMAEnable
	RTS

;---------------------------------------------------------------------------

CODE_00D977:
CODE_tile_animation_09:                            ; advances DATA_568000 source pointer by $0200 every 8 frames (4-frame cycle)
	INC.w $0B6D
	LDA.w $0B6D
	CMP.w #$0008
	BCC.b CODE_00D992
	STZ.w $0B6D
	LDA.w $0B67
	CLC
	ADC.w #$0200
	AND.w #$0600
	STA.w $0B67
CODE_00D992:
	LDA.w #DATA_568000
	CLC
	ADC.w $0B67
	JMP.w CODE_00D808

;---------------------------------------------------------------------------

CODE_00D99C:
CODE_tile_animation_0A:                            ; advances DATA_568000+$3000 source pointer by $0200 every 8 frames (8-frame cycle)
	LDA.w $0B6D
	CMP.w #$0008
	BCC.b CODE_00D9B4
	STZ.w $0B6D
	LDA.w $0B67
	CLC
	ADC.w #$0200
	AND.w #$0E00
	STA.w $0B67
CODE_00D9B4:
	LDA.w #DATA_568000+$3000
	CLC
	ADC.w $0B67
	JMP.w CODE_00D808

;---------------------------------------------------------------------------

DATA_00D9BE:
	dw DATA_568000+$3000,DATA_568000+$3200,DATA_568000+$3400,DATA_568000+$3600,DATA_568000+$3800,DATA_568000+$3A00,DATA_568000+$3C00,DATA_568000+$3E00
	dw DATA_568000+$3C00,DATA_568000+$3A00,DATA_568000+$3800,DATA_568000+$3600,DATA_568000+$3400,DATA_568000+$3200

DATA_00D9DA:
	dw $000A,$0004,$0004,$0004,$0004,$0004,$0004,$000A
	dw $0004,$0004,$0004,$0004,$0004,$0004

CODE_00D9F6:
CODE_tile_animation_0B:                            ; alternates: even frame runs CODE_tile_animation_02 (water); odd frame steps through DATA_00D9BE 14-entry table
	LDA.w $7974
	AND.w #$0001
	BNE.b CODE_00DA02
	JSR.w CODE_tile_animation_02
	RTS

CODE_00DA02:
	LDA.w $0B67
	AND.w #$000F
	ASL
	TAY
	LDA.w $0B6D
	CMP.w DATA_00D9DA,y
	BCC.b CODE_00DA23
	STZ.w $0B6D
	INC.w $0B67
	LDA.w $0B67
	CMP.w #$000E
	BCC.b CODE_00DA23
	STZ.w $0B67
CODE_00DA23:
	LDA.w DATA_00D9BE,y
	JMP.w CODE_00D808

;---------------------------------------------------------------------------

DATA_00DA29:
	dw FXDATA_520000+$E000,FXDATA_520000+$E100,FXDATA_520000+$E200,FXDATA_520000+$E300,FXDATA_520000+$F400,FXDATA_520000+$F500,FXDATA_520000+$F600,FXDATA_520000+$F700
	dw FXDATA_520000+$F400,FXDATA_520000+$F500,FXDATA_520000+$E200,FXDATA_520000+$E300

DATA_00DA41:
	dw FXDATA_520000+$F800,FXDATA_520000+$F900,FXDATA_520000+$FA00,FXDATA_520000+$FB00,FXDATA_520000+$FC00,FXDATA_520000+$FD00,FXDATA_520000+$FE00,FXDATA_520000+$FF00
	dw FXDATA_520000+$FC00,FXDATA_520000+$FD00,FXDATA_520000+$FA00,FXDATA_520000+$FB00

DATA_00DA59:
	dw $0010,$000C,$000C,$0010,$000C,$000C

CODE_00DA65:
CODE_tile_animation_0C:                            ; 6-frame cycle, alternates DATA_00DA29/DATA_00DA41 source pages each frame
	LDX.w $0B67
	LDA.w $0B6D
	CMP.w DATA_00DA59,x
	BCC.b CODE_00DA83
	STZ.w $0B6D
	LDA.w $0B67
	INC
	INC
	CMP.w #$000C
	BCC.b CODE_00DA80
	LDA.w #$0000
CODE_00DA80:
	STA.w $0B67
CODE_00DA83:
	LDA.w $0B67
	ASL
	TAY
	LDX.b #(FXDATA_520000+$E000)>>16
	STX.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDX.b #$01
	LDA.w $7974
	AND.w #$0002
	BNE.b CODE_00DABD
	LDA.w DATA_00DA29,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$1000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.w !REGISTER_DMAEnable
	LDA.w DATA_00DA29+$02,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$1100
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.w !REGISTER_DMAEnable
	RTS

CODE_00DABD:
	LDA.w DATA_00DA41,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$1080
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.w !REGISTER_DMAEnable
	LDA.w DATA_00DA41+$02,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$1180
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0100
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.w !REGISTER_DMAEnable
	RTS

;---------------------------------------------------------------------------

CODE_00DAE4:
CODE_tile_animation_0D:                            ; runs CODE_tile_animation_07 normally; every 6 frames also bumps DATA_00D7D5 cursor
	INC.w $0B6F
	LDA.w $0B6F
	CMP.w #$0006
	BCS.b CODE_00DAF2
	JMP.w CODE_tile_animation_07

CODE_00DAF2:
	STZ.w $0B6F
	LDA.w $0B69
	INC
	INC
	AND.w #$000E
	STA.w $0B69
	LDY.w $0B69
	JMP.w CODE_00D805

CODE_00DB06:
CODE_tile_animation_0E:                            ; alternates between CODE_tile_animation_0C and the DATA_00D7D5 cursor bump
	INC.w $0B6F
	LDA.w $7974
	AND.w #$0001
	BEQ.b CODE_00DAF2
	JMP.w CODE_00DA65

;---------------------------------------------------------------------------

DATA_00DB14:
	dw DATA_568000+$2800,DATA_568000+$2A00,DATA_568000+$2C00,DATA_568000+$2E00

CODE_00DB1C:
CODE_tile_animation_0F:                            ; 4-frame cycle (4-frame per slot), DATA_568000 $2800-$2E00
	LDA.w $0B71
	INC
	CMP.w #$0006
	BCC.b CODE_00DB2B
	INC.w $0B6B
	LDA.w #$0000
CODE_00DB2B:
	STA.w $0B71
	LDX.b #$01
	LDY.w $0B6B
	CMP.w #$0000
	BNE.b CODE_00DB43
	TYA
	AND.w #$0006
	TAY
	LDA.w DATA_00DB14,y
	JMP.w CODE_00D808

CODE_00DB43:
	RTS

;---------------------------------------------------------------------------

DATA_00DB44:                                    ; flavor: data (followed by dw); CODE_ name is a documentation bug
	dw DATA_568000+$4000,DATA_568000+$4100,DATA_568000+$4200,DATA_568000+$4300

DATA_00DB4C:
	dw DATA_568000+$4080,DATA_568000+$4180,DATA_568000+$4280,DATA_568000+$4380

CODE_00DB54:
CODE_tile_animation_10:                            ; 4-frame cycle DATA_568000+$4000/+$4080 paired into VRAM $1000/$1080
	LDA.w $0B6D
	AND.w #$000C
	LSR
	TAY
	LDX.b #(DATA_568000+$4000)>>16
	STX.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w DATA_00DB44,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$2F00
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0080
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDX.b #$01
	STX.w !REGISTER_DMAEnable
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDA.w DATA_00DB4C,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$2F80
	STA.w !REGISTER_VRAMAddressLo
	STX.w !REGISTER_DMAEnable
	RTS

;---------------------------------------------------------------------------

CODE_00DB86:
CODE_tile_animation_11:                            ; every 4 frames runs CODE_tile_animation_03 (smiley clouds); other frames CODE_tile_animation_0C
	LDA.w $7974
	AND.w #$0003
	BNE.b CODE_00DB91
	JMP.w CODE_tile_animation_03

CODE_00DB91:
	JMP.w CODE_00DA65

;---------------------------------------------------------------------------

CODE_00DB94:
CODE_bg3_tilemap_stitch_l:                         ; JSL-callable wrapper around CODE_bg3_tilemap_stitch (sets DP=$420B, runs once)
	REP.b #$20
	PHD
	LDA.w #!REGISTER_DMAEnable
	TCD
	LDA.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	LDX.b #$01
	JSR.w CODE_bg3_tilemap_stitch
	PLD
	SEP.b #$20
	RTL

CODE_00DBA9:
CODE_bg3_tilemap_stitch:                           ; DMA two pending BG3 stitching slices ($0077 horizontal, $0079 vertical) from $006DAA/$006E2A staging into VRAM
	LDY.b #$006DAA>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDY.b #$81
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDY.w $0077
	BEQ.b CODE_00DBD5
	LDA.w #$006DAA
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $007B
	STA.w !REGISTER_VRAMAddressLo
	LDY.b #$40
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $007F
	STA.w !REGISTER_VRAMAddressLo
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	STZ.w $0077
CODE_00DBD5:
	LDY.b #$80
	STY.w !REGISTER_VRAMAddressIncrementValue
	LDY.w $0079
	BEQ.b CODE_00DC1B
	LDA.w #$006E2A
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $007D
	STA.w !REGISTER_VRAMAddressLo
	LDA.w $0083
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $0081
	STA.w !REGISTER_VRAMAddressLo
	LDA.w $0087
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $0085
	STA.w !REGISTER_VRAMAddressLo
	LDA.w $0083
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $0089
	STA.w !REGISTER_VRAMAddressLo
	LDA.w $0087
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	STZ.w $0079
CODE_00DC1B:
	RTS

;---------------------------------------------------------------------------

CODE_00DC1C:
CODE_queued_vram_4byte_writes:                     ; walk queue at $09EF (4-byte entries: dest, source); DMA 4 bytes per entry into VRAM and its companion 32-row sibling
	LDA.w $09ED
	BEQ.b CODE_00DC60
	LDX.b #$80
	STX.w !REGISTER_VRAMAddressIncrementValue
	LDX.b #$01
	STX.b DMA[$00].Parameters-!REGISTER_DMAEnable
	LDX.b #!REGISTER_WriteToVRAMPortLo
	STX.b DMA[$00].Destination-!REGISTER_DMAEnable
	LDX.b #FXDATA_4C33F2>>16
	STX.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDY.b #$00
	LDX.b #$01
CODE_00DC36:
	LDA.w $09EF,y
	BMI.b CODE_00DC60
	PHA
	STA.w !REGISTER_VRAMAddressLo
	LDA.w $09F1,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #$0004
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	PLA
	CLC
	ADC.w #$0020
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$0004
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	INY
	INY
	INY
	INY
	BRA.b CODE_00DC36

CODE_00DC60:
	LDA.w #$0000
	STA.w $09ED
	DEC
	STA.w $09EF
	RTS

;---------------------------------------------------------------------------

CODE_00DC6B:
CODE_bg3_tilemap_flush:                            ; flush BG3 tilemap from SRAM staging ($70:5800) to VRAM when $0CF9 dirty-flag is non-zero
	LDA.w $0CF9
	BEQ.b CODE_00DC96
	BPL.b CODE_00DC7D
	AND.w #$7FE0
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$6800
	BRA.b CODE_00DC86

CODE_00DC7D:
	LDA.w #$5C00
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$705800
CODE_00DC86:
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #$705800>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$0800
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	STZ.w $0CF9
CODE_00DC96:
	RTS

;---------------------------------------------------------------------------

CODE_00DC97:
CODE_pause_overlay_tilemap_flush:                  ; DMA $0800 bytes from $70:4E00 to VRAM $3000 (pause-menu overlay tilemap)
	LDA.w #$3000
	STA.w !REGISTER_VRAMAddressLo
	LDA.w #$704E00
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #$704E00>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$0800
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	RTS

;---------------------------------------------------------------------------

CODE_00DCAE:
CODE_bg1_tile_stamp_finaliser:                     ; DMA the per-frame BG1 tile-stamp triplets ($6128/612A/612C/...) from staging into VRAM $4000-$5800
	LDA.w #$4000
	STA.w !REGISTER_VRAMAddressLo
	LDY.b #$40
	LDA.w $6128
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $612A
	STA.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $612C
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $612E
	STA.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $6130
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $6132
	STA.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $6134
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $6136
	STA.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $6138
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $613A
	STA.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $613C
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $613E
	STA.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $6140
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $6142
	STA.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$0020
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDA.w $6145
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	LDA.w $6144
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w #$4100
	STA.w !REGISTER_VRAMAddressLo
	LDA.w $6128
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $612A
	XBA
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $612C
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $612E
	XBA
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $6130
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $6132
	XBA
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $6134
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $6136
	XBA
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $6138
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $613A
	XBA
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $613C
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $613E
	XBA
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $6140
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $6142
	XBA
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	LDA.w #$0020
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDA.w $6144
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $6146
	XBA
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $0B85
	BEQ.b CODE_00DDE7
	LDA.w #$4620
	STA.w !REGISTER_VRAMAddressLo
	LDA.w $0B87
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w #(FXDATA_520000+$4840)>>16
	STA.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $0B8B
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w #$4720
	STA.w !REGISTER_VRAMAddressLo
	LDA.w $0B89
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w $0B8D
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	STY.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	STZ.w $0B85
CODE_00DDE7:
	LDA.w $6114
	BEQ.b CODE_00DE0B
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDY.b #(FXDATA_520000+$B600)>>16
	STY.b DMA[$00].SourceBank-!REGISTER_DMAEnable
	LDA.w #$4200
	STA.w !REGISTER_VRAMAddressLo
	LDY.b #$01
	STY.b DMA[$00].SizeHi-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	LDA.w #$4300
	STA.w !REGISTER_VRAMAddressLo
	STY.b DMA[$00].SizeHi-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	STZ.w $6114
CODE_00DE0B:
	RTS

;---------------------------------------------------------------------------

CODE_00DE0C:
CODE_process_multi_wram_dma_queue:                 ; drain the multi-DMA buffer at $096F (8-byte entries: dest, src, size) into WRAM via DMA channel 0
	LDA.w #((!REGISTER_ReadOrWriteToWRAMPort&$0000FF)<<8)+$00
	STA.b DMA[$00].Parameters-!REGISTER_DMAEnable
	LDY.b #$02
	LDA.w $096D,y
	BEQ.b CODE_00DE43
CODE_00DE18:
	STA.b DMA[$00].SizeLo-!REGISTER_DMAEnable
	LDA.w $096F,y
	STA.w !REGISTER_WRAMAddressLo
	LDA.w $0970,y
	STA.w !REGISTER_WRAMAddressHi
	LDA.w $0972,y
	STA.b DMA[$00].SourceLo-!REGISTER_DMAEnable
	LDA.w $0973,y
	STA.b DMA[$00].SourceHi-!REGISTER_DMAEnable
	STX.b !REGISTER_DMAEnable-!REGISTER_DMAEnable
	TYA
	CLC
	ADC.w #$0008
	TAY
	LDA.w $096D,y
	BNE.b CODE_00DE18
	STZ.w $096D
	STZ.w $096F
CODE_00DE43:
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; YI_BeginSuperFXProcessingRt / gsu_init_1 (CODE_00DE44) -- minimal
; SuperFX kick. Clears SFR (Status/Flag Register), restores SCBR
; ($012D mirror) and SCMR ($012E mirror), sets the PC bank (X) and
; address (A), sets the "go" bit, spin-waits for SFR's go bit to clear
; (SuperFX is done), then hands ROM/RAM bus back to the SCPU.
; Raidenthequick: gsu_init_1.
;
; INPUTS:   X = SuperFX program bank; A = SuperFX program counter (16-bit);
;           $012D/$012E pre-set by CODE_init_scene_regs (per-scene SCBR/SCMR).
; OUTPUTS:  R-register results left in $3000-$303E by the SuperFX program.
; MODIFIES: A, Y; SuperFX regs SFR, SCBR, SCMR, PBR, R15.
; CALLERS:  every gameplay/render path that needs a SuperFX call: OAM
;           init, level-name overlay, decompression, sprite scaling,
;           Map16 fetch, CODE_change_map16, save-egg-inventory, etc. The most
;           commonly invoked is FXCODE_08A97B (set up by CODE_yi_reset).
;-------------------------------------------------------------------------
YI_BeginSuperFXProcessingRt:
gsu_init_1:                                   ; Raidenthequick: gsu_init_1
;$00DE44
	STZ.w !REGISTER_SuperFX_StatusFlagsLo
CODE_00DE47:
	LDY.w $012D
	STY.w !REGISTER_SuperFX_ScreenBase
	LDY.w $012E
	STY.w !REGISTER_SuperFX_ScreenMode
	STX.w !REGISTER_SuperFX_ProgramBankRegister
	STA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	LDA.w #!SuperFX_StatusFlags_GoFlag
CODE_00DE5C:
	BIT.w !REGISTER_SuperFX_StatusFlagsLo
	BNE.b CODE_00DE5C
	LDY.b #!SuperFX_ScreenMode_ScreenHeight_128pixels|!SuperFX_ScreenMode_ColorMode_4Colors|!SuperFX_ScreenMode_SNESasWRAMAccess|!SuperFX_ScreenMode_SNESasROMAccess
	STY.w !REGISTER_SuperFX_ScreenMode
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_gsu_init_2 -- gsu_init_1 with an extra pre-setup pass via
; CODE_star_timer_and_lives_tick (handles SuperFX clock-mode swap to high-speed). Used by
; render paths that benefit from high-speed SuperFX.
; Raidenthequick: CODE_gsu_init_2.
;-------------------------------------------------------------------------
CODE_00DE67:
CODE_gsu_init_2:                                   ; Raidenthequick: CODE_gsu_init_2
	PHB
	STZ.w !REGISTER_SuperFX_StatusFlagsLo
	LDY.w $012D
	STY.w !REGISTER_SuperFX_ScreenBase
	LDY.w $012E
	STY.w !REGISTER_SuperFX_ScreenMode
	STX.w !REGISTER_SuperFX_ProgramBankRegister
	STA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	PHK
	PLB
	JSR.w CODE_star_timer_and_lives_tick
	PLB
	LDA.w #!SuperFX_StatusFlags_GoFlag
CODE_00DE86:
	BIT.w !REGISTER_SuperFX_StatusFlagsLo
	BNE.b CODE_00DE86
	LDY.b #!SuperFX_ScreenMode_ScreenHeight_128pixels|!SuperFX_ScreenMode_ColorMode_4Colors|!SuperFX_ScreenMode_SNESasWRAMAccess|!SuperFX_ScreenMode_SNESasROMAccess
	STY.w !REGISTER_SuperFX_ScreenMode
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_gsu_init_3 -- gsu_init_1 with a "loop while R0 != 0"
; behaviour. Used by SuperFX routines that need to fetch additional
; chunks from $7F:0000+ (extended sprite-tile fetch) between cycles.
; Raidenthequick: CODE_gsu_init_3.
;-------------------------------------------------------------------------
CODE_00DE91:
CODE_gsu_init_3:                                   ; Raidenthequick: CODE_gsu_init_3
	STZ.w !REGISTER_SuperFX_StatusFlagsLo
	LDY.w $012D
	STY.w !REGISTER_SuperFX_ScreenBase
	LDY.w $012E
	STY.w !REGISTER_SuperFX_ScreenMode
	STX.w !REGISTER_SuperFX_ProgramBankRegister
	STA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	REP.b #$10
	LDA.w #!SuperFX_StatusFlags_GoFlag
	TAY
CODE_00DEAC:
	BIT.w !REGISTER_SuperFX_StatusFlagsLo
	BNE.b CODE_00DEAC
	LDX.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BEQ.b CODE_00DEC6
	LDA.l $7F0000,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	STA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	TYA
	BRA.b CODE_00DEAC

CODE_00DEC6:
	LDY.w #!SuperFX_ScreenMode_ScreenHeight_128pixels|!SuperFX_ScreenMode_ColorMode_4Colors|!SuperFX_ScreenMode_SNESasWRAMAccess|!SuperFX_ScreenMode_SNESasROMAccess
	STY.w !REGISTER_SuperFX_ScreenMode
	SEP.b #$10
	RTL

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_gsu_init_4 -- the most-featured SuperFX wrapper. After
; each spin-wait it inspects R0: BPL = use as a stop-code index into
; DATA_gsu_stop_code_dispatch (14-entry dispatch of "ask SCPU to do this for me, then
; continue") routines covering Map16 changes, player hit/death, scroll
; events, etc; BMI = bitmap-fetch with R0 used as ExRAM index. The
; SuperFX side issues these stop codes via `stop`/yield protocol.
; Raidenthequick: CODE_gsu_init_4.
;-------------------------------------------------------------------------
CODE_00DECF:
CODE_gsu_init_4:                                   ; Raidenthequick: CODE_gsu_init_4
	STZ.w !REGISTER_SuperFX_StatusFlagsLo
	LDY.w $012D
	STY.w !REGISTER_SuperFX_ScreenBase
	LDY.w $012E
	STY.w !REGISTER_SuperFX_ScreenMode
	STX.w !REGISTER_SuperFX_ProgramBankRegister
	STA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	REP.b #$10
	LDA.w #!SuperFX_StatusFlags_GoFlag
	TAY
CODE_00DEEA:
	BIT.w !REGISTER_SuperFX_StatusFlagsLo
	BNE.b CODE_00DEEA
	LDX.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	BPL.b CODE_00DF04
	LDA.l $7F0000,x
	STA.w !REGISTER_SuperFX_R0_DefaultSourceOrDestinationLo
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	STA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	TYA
	BRA.b CODE_00DEEA

CODE_00DF04:
	BEQ.b CODE_00DF1F
	STZ.w !REGISTER_SuperFX_ScreenMode
	JSR.w (DATA_gsu_stop_code_dispatch-$02,x)
	SEP.b #$20
	LDA.w $012E
	STA.w !REGISTER_SuperFX_ScreenMode
	REP.b #$20
	LDA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	STA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	TYA
	BRA.b CODE_00DEEA

CODE_00DF1F:
	LDY.w #!SuperFX_ScreenMode_ScreenHeight_128pixels|!SuperFX_ScreenMode_ColorMode_4Colors|!SuperFX_ScreenMode_SNESasWRAMAccess|!SuperFX_ScreenMode_SNESasROMAccess
	STY.w !REGISTER_SuperFX_ScreenMode
	SEP.b #$10
	RTL

;-------------------------------------------------------------------------
; DATA_gsu_stop_code_dispatch -- 14-entry SuperFX-yield handlers.
; Indexed in CODE_gsu_init_4 by (R0 - 2)*2 / 2 = R0/2 effectively (table is
; word-stride; called via JSR (DATA_gsu_stop_code_dispatch-$02,X) where X = R0).
;
; Stop codes (R0 value) and meaning:
;   $0002 = CODE_00DF68 -- Spawn ambient sprite at R6's tile coords;
;                          if R6 == $A400 also handle "red coin collected"
;                          (sound + increment counter; bump every 4 red
;                          coins to coin-count update).
;   $0004 = CODE_00E04F -- "$008F = 0" CODE_change_map16 (basic tile change).
;   $0006 = CODE_00E0A9 -- "$008F = 4" CODE_change_map16 with DATA_00E081 lookup
;                          for the bonus-tile variation.
;   $0008 = CODE_00E0CD -- JSL CODE_03BF87 (mystery sprite trigger).
;   $000A = CODE_00DFC3 -- "$008F = 1, $0095 = 0" CODE_change_map16.
;   $000C = CODE_00E023 -- $0A + extend to right/bottom (2x2 CODE_change_map16).
;   $000E = CODE_00E017 -- "$008F = 1, $0095 = R5" CODE_change_map16.
;   $0010 = CODE_00E0D7 -- World-6-specific: JSL CODE_04F1F6 (BG3 sub).
;   $0012 = CODE_00E0E6 -- CODE_player_death_spike (lava/spike collision).
;   $0014 = CODE_00E0F2 -- CODE_player_hit (regular enemy collision).
;   $0016 = CODE_00DF44 -- Bowser fight: advance to fade-out if won;
;                          else JSL CODE_02A4B5 (boss-arena change).
;   $0018 = CODE_00E068 -- "$008F = 6" CODE_change_map16.
;   $001A = CODE_player_death_lava -- player_death + bounce (fall-out-of-level).
;   $001C = CODE_00E126 -- Mystery-sprite contact (Yoshi colour-change /
;                          Baby Mario pickup, dispatched by sprite ID).
;-------------------------------------------------------------------------
DATA_00DF28:
DATA_gsu_stop_code_dispatch:
	dw CODE_00DF68                            ; $02 spawn ambient sprite / red coin
	dw CODE_00E04F                            ; $04 CODE_change_map16 ($008F=0)
	dw CODE_00E0A9                            ; $06 CODE_change_map16 ($008F=4)
	dw CODE_00E0CD                            ; $08 CODE_03BF87 (mystery sprite)
	dw CODE_00DFC3                            ; $0A CODE_change_map16 ($008F=1)
	dw CODE_00E023                            ; $0C 2x2 CODE_change_map16
	dw CODE_00E017                            ; $0E CODE_change_map16 ($008F=1,R5)
	dw CODE_00E0D7                            ; $10 W6 special (CODE_04F1F6)
	dw CODE_00E0E6                            ; $12 CODE_player_death_spike
	dw CODE_00E0F2                            ; $14 CODE_player_hit
	dw CODE_00DF44                            ; $16 Bowser fight done check
	dw CODE_00E068                            ; $18 CODE_change_map16 ($008F=6)
	dw CODE_player_death_lava                            ; $1A player_death + bounce
	dw CODE_00E126                            ; $1C mystery-sprite contact

;---------------------------------------------------------------------------

CODE_00DF44:
	PHY
	LDA.w !RAM_YI_Level_CurrentLevelFromMapLo
	CMP.w #!Define_YI_LevelID_WelcomeToYoshisIsland
	BNE.b CODE_00DF62
	STZ.w !RAM_YI_Level_CurrentLevelFromMapLo
	LDA.w #!Define_YI_GameMode1F
	STA.w !RAM_YI_Global_CurrentGameMode
	LDA.w #$0001
	STA.w $022D
	JSL.l CODE_save_egg_inventory
	PLY
	RTS

CODE_00DF62:
	JSL.l CODE_02A4B5
	PLY
	RTS

;---------------------------------------------------------------------------

CODE_00DF68:
	PHY
	SEP.b #$10
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	CMP.w #$A400
	BNE.b CODE_00DF7A
	JSR.w CODE_00DFE2
	SEP.b #$10
	BRA.b CODE_00DF97

CODE_00DF7A:
	LDA.w $6000
	AND.w #$FFF0
	STA.w $0000
	LDA.w $6002
	AND.w #$FFF0
	STA.w $0002
	JSL.l CODE_03A520
	LDA.w #!Define_YI_SoundID09_Coin
	JSL.l CODE_push_sound_queue
CODE_00DF97:
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
	REP.b #$10
	LDA.w #$0000
	STA.w $0095
	LDA.w #$0007
	BRA.b CODE_00DFCD

CODE_00DFC3:
	LDA.w #$0000
	STA.w $0095
CODE_00DFC9:
	PHY
	LDA.w #$0001
CODE_00DFCD:
	STA.w $008F
	LDA.w $6000
	STA.w $0091
	LDA.w $6002
	STA.w $0093
	JSL.l CODE_change_map16
	PLY
	RTS

;---------------------------------------------------------------------------

CODE_00DFE2:
	LDA.w #!Define_YI_SoundID93_RedCoin
	INC.w !RAM_YI_Level_RedCoinsCollectedLo
	LDY.w !RAM_YI_Level_RedCoinsCollectedLo
	CPY.w #$0014
	BMI.b CODE_00DFF1
	INC
CODE_00DFF1:
	JSL.l CODE_push_sound_queue
	LDA.w #$0002
	STA.w $0006
	SEP.b #$10
	LDA.w $6000
	AND.w #$FFF0
	STA.w $0000
	LDA.w $6002
	AND.w #$FFF0
	JSL.l CODE_03A4F5
	REP.b #$10
	RTS

CODE_00E013:
	JSR.w CODE_00DFE2
	RTL

;---------------------------------------------------------------------------

CODE_00E017:
	LDA.w !REGISTER_SuperFX_R5_GeneralPurpose2Lo
	STA.w $0095
	BRA.b CODE_00DFC9

;---------------------------------------------------------------------------

CODE_00E01F:
	JSR.w CODE_00E023
	RTL

CODE_00E023:
	JSR.w CODE_00DFC3
	PHY
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
	LDA.w $6000
	STA.w $0091
	JSL.l CODE_change_map16
	PLY
	RTS

;---------------------------------------------------------------------------

CODE_00E04F:
	PHY
	LDA.w $6000
	STA.w $0091
	LDA.w $6002
	STA.w $0093
	LDA.w #$0000
	STA.w $008F
	JSL.l CODE_change_map16
	PLY
	RTS

;---------------------------------------------------------------------------

CODE_00E068:
	PHY
	LDA.w $6000
	STA.w $0091
	LDA.w $6002
	STA.w $0093
	LDA.w #$0006
	STA.w $008F
	JSL.l CODE_change_map16
	PLY
	RTS

;---------------------------------------------------------------------------

DATA_00E081:
	dw $0000,$0000,$0000,$2A0D,$0000,$0000,$0000,$2A1C
	dw $0000,$0000,$0000,$2A2B,$0000,$0000,$0000,$2A3A
	dw $0000,$0000,$0000,$964C

CODE_00E0A9:
	PHY
	LDA.w !REGISTER_SuperFX_R6_MultiplierLo
	AND.w #$00FF
	ASL
	TAX
	LDA.l DATA_00E081,x
	STA.b $95
	LDA.w $6000
	STA.b $91
	LDA.w $6002
	STA.b $93
	LDA.w #$0004
	STA.b $8F
	JSL.l CODE_change_map16
	PLY
	RTS

;---------------------------------------------------------------------------

CODE_00E0CD:
	PHY
	LDX.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	JSL.l CODE_03BF87
	PLY
	RTS

;---------------------------------------------------------------------------

CODE_00E0D7:
	LDA.w !RAM_YI_Level_LevelHeaderBG3TilesetLo
	CMP.w #$000A
	BNE.b CODE_00E0E5
	PHY
	JSL.l CODE_04F1F6
	PLY
CODE_00E0E5:
	RTS

;---------------------------------------------------------------------------

CODE_00E0E6:
	LDA.w $0CCA
	BNE.b CODE_00E0F1
	PHY
	JSL.l CODE_player_death_spike
	PLY
CODE_00E0F1:
	RTS

;---------------------------------------------------------------------------

CODE_00E0F2:
	PHY
	SEP.b #$10
	JSL.l CODE_player_hit
	REP.b #$10
	PLY
	RTS

;---------------------------------------------------------------------------

DATA_00E0FD:
	dw $0080,$FF80

; SMWC: Kill Yoshi Subroutine (lava-death variant). Mirrored into WRAM
; (jump to $7EE101 if GSU is active). DATA_00E0FD = X-speed pair
; (facing right/left); the LDA.w #$FB00 at $00E10E loads the initial
; Y-speed for the death animation.
CODE_00E101:
CODE_player_death_lava:
	LDA.w $0CCA
	BNE.b CODE_00E125
	PHY
	LDA.w #!Define_YI_PlayerState28_TouchedLava
	JSL.l CODE_04F6E2
	LDA.w #$FB00
	STA.w $60AA
	LDX.w $60C4
	LDA.l DATA_00E0FD,x
	STA.w $60A8
	LDA.w #$0020
	STA.w $61F6
	PLY
CODE_00E125:
	RTS

;---------------------------------------------------------------------------

CODE_00E126:
	PHY
	LDA.w $6000
	STA.l $007972
	SEP.b #$10
	TAX
	LDA.w !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
	CMP.w #!Define_YI_NorSpr115_Coin
	BEQ.b CODE_00E144
	CMP.w #!Define_YI_NorSpr065_RedCoin
	BNE.b CODE_00E14A
	JSL.l CODE_0CEA92
	BRA.b CODE_00E14E

CODE_00E144:
	JSL.l CODE_04CA27
	BRA.b CODE_00E14E

CODE_00E14A:
	JSL.l CODE_0EB499
CODE_00E14E:
	REP.b #$10
	PLY
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_gsu_init_5 -- "tilemap-stitch" SuperFX wrapper. After
; the SuperFX program (typically BG3 tilemap stitcher in bank $56) runs,
; this routine processes its output by walking BG2/BG3 layer Y-position
; values and stamping rotated/scaled BG2 tile-info entries based on
; LayerNYPosLo/Hi vs camera. Used heavily by the cloud / lava / water
; animators that compose BG2/BG3 from per-row offsets.
; Raidenthequick: CODE_gsu_init_5.
;-------------------------------------------------------------------------
CODE_00E152:
CODE_gsu_init_5:                                   ; Raidenthequick: CODE_gsu_init_5
	PHB
	STZ.w !REGISTER_SuperFX_StatusFlagsLo
	LDY.w $012D
	STY.w !REGISTER_SuperFX_ScreenBase
	LDY.w $012E
	STY.w !REGISTER_SuperFX_ScreenMode
	STX.w !REGISTER_SuperFX_ProgramBankRegister
	STA.w !REGISTER_SuperFX_R15_ProgramCounterLo
	LDA.w $011A
	BEQ.b CODE_00E170
	JMP.w CODE_00E225

CODE_00E170:
	PHK
	PLB
	REP.b #$10
	LDX.b $04
	LDY.b $06
	LDA.w #$000C
	STA.b $0C
CODE_00E17D:
	CPX.w #$01FE
	BCC.b CODE_00E188
	STZ.b $0E
	LDA.b !RAM_YI_Global_Layer2YPosLo
	BRA.b CODE_00E1EE

CODE_00E188:
	TYA
	LSR
	LSR
	STA.b $08
	CLC
	ADC.w #$0008
	CMP.w #$0020
	BCC.b CODE_00E199
	LDA.w #$0020
CODE_00E199:
	ASL
	STA.b $0A
	LDA.w DATA_sine_lut_8bit_radians,x
	PHP
	BPL.b CODE_00E1A6
	EOR.w #$FFFF
	INC
CODE_00E1A6:
	CMP.w #$0100
	SEP.b #$20
	XBA
	LDA.b $0A
	BCS.b CODE_00E1C4
	STA.l !REGISTER_Multiplicand
	XBA
	STA.l !REGISTER_Multiplier
	NOP #3
	REP.b #$20
	LDA.l $004217
	BRA.b CODE_00E1C6

CODE_00E1C4:
	REP.b #$20
CODE_00E1C6:
	AND.w #$00FF
	LSR
	LSR
	LSR
	LSR
	PLP
	BPL.b CODE_00E1D4
	EOR.w #$FFFF
	INC
CODE_00E1D4:
	STA.b $0E
	CLC
	ADC.b $08
	AND.w #$00FF
	CMP.w #$0030
	LDA.b $0E
	BCC.b CODE_00E1EB
	LDA.b $08
	EOR.w #$FFFF
	ADC.w #$002F
CODE_00E1EB:
	CLC
	ADC.b !RAM_YI_Global_Layer2YPosLo
CODE_00E1EE:
	STA.w $7E55C6,y
CODE_00E1F1:
	LDA.b $0E
	STA.w $7E55C4,y
	PHX
	TXA
	CMP.w #$01FE
	BCC.b CODE_00E200
	LDA.w #$01FE
CODE_00E200:
	LSR
	AND.w #$00FC
	TAX
	LDA.w $7E54C2,x
	STA.w $7E53C2,y
	PLA
	SEC
	SBC.w #$0010
	AND.w #$07FE
	TAX
	INY
	INY
	INY
	INY
	DEC.b $0C
	BEQ.b CODE_00E21F
	JMP.w CODE_00E17D

CODE_00E21F:
	STX.b $04
	STY.b $06
	SEP.b #$10
CODE_00E225:
	PLB
	LDA.w #!SuperFX_StatusFlags_GoFlag
CODE_00E229:
	BIT.w !REGISTER_SuperFX_StatusFlagsLo
	BNE.b CODE_00E229
	LDY.b #!SuperFX_ScreenMode_ScreenHeight_128pixels|!SuperFX_ScreenMode_ColorMode_4Colors|!SuperFX_ScreenMode_SNESasWRAMAccess|!SuperFX_ScreenMode_SNESasROMAccess
	STY.w !REGISTER_SuperFX_ScreenMode
	RTL

;---------------------------------------------------------------------------

DATA_00E234:
	dw $0064,$000A

DATA_00E238:
	dw $000A,$FFF6

DATA_00E23C:
	dw $012C,$0000

CODE_00E240:
CODE_star_timer_and_lives_tick:                    ; cap lives at $03E7; tick star-timer; handle flower-collect chime; per-frame book-keeping piggy-backed on CODE_gsu_init_2's spin-wait
	REP.b #$10
	LDA.w !RAM_YI_Level_CurrentLifeCountLo
	CMP.w #$03E8
	BCC.b CODE_00E25E
	LDA.w #$03E7
	STA.w !RAM_YI_Level_CurrentLifeCountLo
	LDA.w !RAM_YI_Level_1upsCollectedInCurrentLevelLo
	CMP.w #$03E8
	BCC.b CODE_00E25E
	LDA.w #$03E7
	STA.w !RAM_YI_Level_1upsCollectedInCurrentLevelLo
CODE_00E25E:
	STZ.w $0389
	INC.w $03A9
	LDY.w #$0000
	LDA.w $0396
	BEQ.b CODE_00E2B5
	BPL.b CODE_00E270
	INY
	INY
CODE_00E270:
	LDA.w $0B57
	BNE.b CODE_00E27D
	LDA.w $03A9
	CMP.w #$0008
	BCC.b CODE_00E2B3
CODE_00E27D:
	LDA.w #!Define_YI_SoundID36_CollectFlower
	JSR.w CODE_push_sound_queue_pres_x
	STZ.w $03A9
	LDA.w !RAM_YI_Level_StarTimerLo
	CLC
	ADC.w DATA_00E238,y
	BMI.b CODE_00E297
	STA.w !RAM_YI_Level_StarTimerLo
	CMP.w DATA_00E23C,y
	BCC.b CODE_00E2A3
CODE_00E297:
	LDA.w DATA_00E23C,y
	STA.w !RAM_YI_Level_StarTimerLo
	STZ.w $0396
	JMP.w CODE_00E32C

CODE_00E2A3:
	LDA.w $0396
	SEC
	SBC.w DATA_00E238,y
	STA.w $0396
	TYA
	BNE.b CODE_00E2B3
	INC.w $0389
CODE_00E2B3:
	BRA.b CODE_00E32C

CODE_00E2B5:
	LDA.w $0387
	BMI.b CODE_00E2CC
	BNE.b CODE_00E32C
	LDA.w $0B57
	ORA.w $0B65
	ORA.w $0B7B
	ORA.w !RAM_YI_Level_MessageBoxState 
	BEQ.b CODE_00E2F5
	BRA.b CODE_00E32C

CODE_00E2CC:
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_MaxRegenStarTimerThreshold
	BCS.b CODE_00E32C
	INC.w $0394
	LDA.w $0394
	CMP.w #$000C
	BCC.b CODE_00E32C
	STZ.w $0394
	INC.w !RAM_YI_Level_StarTimerLo
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_PlayFinishRegenStarTimerSoundThreshold
	BNE.b CODE_00E32C
	LDA.w #!Define_YI_SoundID32_HitMessageBox
	JSR.w CODE_push_sound_queue_pres_x
	BRA.b CODE_00E32C

CODE_00E2F5:
	STZ.w $0394
	LDA.w $0C8A
	BNE.b CODE_00E36F
	LDA.w !RAM_YI_Level_StarTimerLo
	BEQ.b CODE_00E36F
	INC.w $0392
	LDA.w $0392
	CMP.w #$0004
	BCC.b CODE_00E32C
	STZ.w $0392
	DEC.w !RAM_YI_Level_StarTimerLo
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_SingleDigitStarTimerThreshold
	BCS.b CODE_00E32C
	LDA.w !RAM_YI_Level_StarTimerBelow10Flag
	AND.w #$00FF
	BNE.b CODE_00E32C
	INC.w !RAM_YI_Level_StarTimerBelow10Flag
	LDA.w #!Define_YI_SoundID24_StarTimerLowWarning
	JSR.w CODE_push_sound_queue_pres_x
CODE_00E32C:
	LDX.w #$0000
	LDA.w !RAM_YI_Level_StarTimerLo
	CMP.w #!Define_YI_Level_HardMaxStarTimerThreshold+$01
	BCC.b CODE_00E33D
	LDA.w #!Define_YI_Level_HardMaxStarTimerThreshold
	STA.w !RAM_YI_Level_StarTimerLo
CODE_00E33D:
	LDY.w #$0000
CODE_00E340:
	CMP.w DATA_00E234,x
	BCC.b CODE_00E34B
	SBC.w DATA_00E234,x
	INY
	BRA.b CODE_00E340

CODE_00E34B:
	STY.b $00,x
	INX
	INX
	CPX.w #$0004
	BNE.b CODE_00E33D
	STA.b $00,x
	LDA.b $00
	STA.w $03A1
	LDA.b $02
	STA.w $03A3
	LDA.b $04
	STA.w $03A5
	BNE.b CODE_00E36F
	LDA.w $0392
	BNE.b CODE_00E36F
	INC.w $0389
CODE_00E36F:
	SEP.b #$10
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_push_sound_queue_pres_x -- X-preserving variant of
; CODE_push_sound_queue using DP addressing. Used in tight inner loops where
; X is a slot cursor that must survive the sound push.
; Raidenthequick: CODE_push_sound_queue_pres_x.
;
; INPUTS:   M=8/16; A = sound ID (low byte).
; OUTPUTS:  Sound appended; SoundQueueSize incremented; X unchanged.
; MODIFIES: A; pushes/pops X.
; CALLERS:  per-sprite collision handlers, ambient-sprite cleanup paths,
;           credits-roll text animator.
;-------------------------------------------------------------------------
CODE_00E372:
CODE_push_sound_queue_pres_x:                      ; Raidenthequick: CODE_push_sound_queue_pres_x
	PHX
	LDX.b !RAM_YI_Global_SoundQueueSizeLo
	STA.b !RAM_YI_Global_SoundQueue,x
	INC.b !RAM_YI_Global_SoundQueueSizeLo
	PLX
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_prepare_tilemap_dma_queue_l -- bank-safe JSL wrapper
; around CODE_prepare_tilemap_dma_queue. Use from any DBR;
; restores DBR via PHB/PHK/PLB.
; Raidenthequick: CODE_prepare_tilemap_dma_queue_l.
; See also: ys_dma.asm (DMA queue conventions).
;-------------------------------------------------------------------------
CODE_00E37B:
CODE_prepare_tilemap_dma_queue_l:                  ; Raidenthequick: CODE_prepare_tilemap_dma_queue_l
	PHB
	PHK
	PLB
	JSR.w CODE_prepare_tilemap_dma_queue
	PLB
	RTL

;-------------------------------------------------------------------------
; DATA_tilemap_dma_queue_pointers -- 13-entry 24-bit pointer
; table. $0127 picks one of these as the source queue for
; CODE_prepare_tilemap_dma_queue. Default (index 0) = $7E:4002, the
; RAM-resident dynamic queue that NMI/IRQ writes to. Other indexes point
; at ROM-resident pre-baked tilemap-init streams:
;   $00 = $7E:4002          -- default per-frame queue (writable)
;   $03 = DATA_008275       -- empty / placeholder
;   $06 = DATA_178008       -- Island cutscene init
;   $09 = DATA_01E8F2       -- BG3 tilemap init
;   $0C = DATA_01B62D       -- Score-screen BG1 init
;   $0F = DATA_01B976       -- Score-screen BG3 data
;   $12 = DATA_178000       -- Island graphics init
;   $15 = DATA_0FBC9E       -- map/story/title init
;   $18 = DATA_01B6C1       -- Score-screen BG3 init
;   $1B = DATA_01E8FA       -- In-level BG3 init
;   $1E = DATA_01E542       -- Retry-screen init + tilemap
;   $21 = DATA_01E902       -- In-level BG3 init (alt)
;   $24 = DATA_10E1D2       -- Credits BG1 tilemap init
;-------------------------------------------------------------------------
DATA_00E383:
DATA_tilemap_dma_queue_pointers:                   ; Raidenthequick: DATA_tilemap_dma_queue_pointers
	dl $7E4002,DATA_008275,DATA_178008,DATA_01E8F2
	dl DATA_01B62D,DATA_01B976,DATA_178000,DATA_0FBC9E
	dl DATA_01B6C1,DATA_01E8FA,DATA_01E542,DATA_01E902
	dl DATA_10E1D2

;-------------------------------------------------------------------------
; CODE_prepare_tilemap_dma_queue -- picks the active tilemap-DMA
; queue (via $0127 as index into DATA_tilemap_dma_queue_pointers), runs
; CODE_process_tilemap_dma_queue against it, then resets $7E:4000 and $7E:4003
; (the RAM queue's size + first-entry-sentinel) so the next per-frame
; queue starts clean.
; Raidenthequick: CODE_prepare_tilemap_dma_queue.
;
; INPUTS:   $0127 = queue index (0..36 stride 3).
; OUTPUTS:  Selected queue drained into VRAM; default RAM queue reset
;           if $0127 was 0.
; MODIFIES: A, X, Y; $7E:4000-$7E:4003; $0127 reset to 0.
; CALLERS:  all NMI/IRQ handler paths (CODE_00C094, CODE_00C13C,
;           CODE_00C4B4, CODE_00C885, CODE_00D36F).
;-------------------------------------------------------------------------
CODE_00E3AA:
CODE_prepare_tilemap_dma_queue:                    ; Raidenthequick: CODE_prepare_tilemap_dma_queue
	REP.b #$10
	LDY.w $0127
	LDX.w DATA_tilemap_dma_queue_pointers,y
	LDA.w DATA_tilemap_dma_queue_pointers+$02,y
	JSR.w CODE_process_tilemap_dma_queue
	LDA.w $0127
	BNE.b CODE_00E3CA
	STA.l $7E4000
	STA.l $7E4001
	DEC
	STA.l $7E4003
CODE_00E3CA:
	STZ.w $0127
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; DATA_vram_dma_queue_pointers -- 3-entry queue table for
; CODE_process_vram_dma_queue. Indexed by $0129. Default queue is at $7E:4800
; (written to by the vram_dma_queue_add_* helpers).
;-------------------------------------------------------------------------
DATA_00E3CE:
DATA_vram_dma_queue_pointers:
	dl $7E4800,DATA_11B72A,DATA_11B744

;-------------------------------------------------------------------------
; CODE_process_vram_dma_queue_l -- bank-safe JSL wrapper around
; CODE_process_vram_dma_queue.
;-------------------------------------------------------------------------
CODE_00E3D7:
CODE_process_vram_dma_queue_l:                     ; Raidenthequick: CODE_process_vram_dma_queue_l
	PHB
	PHK
	PLB
	JSR.w CODE_process_vram_dma_queue
	PLB
	RTL

;-------------------------------------------------------------------------
; CODE_process_vram_dma_queue -- drain a VRAM-DMA queue. Each
; entry is 12 bytes. Iterates entries until the "$4802 end-of-queue
; sentinel" is hit, issuing one DMA per entry.
;
; Queue entry layout (12 bytes; matches the vram_dma_queue_add_* helpers
; above):
;   $00-$01 = VRAM dest address (high bit = end-of-queue marker)
;   $02     = video port control mirror (written to $2115 via XBA)
;   $03     = DMA control byte (mode + direction + write/read)
;   $04     = DMA dest register low byte ($18 or $19 for VMDATAL/H)
;   $05-$07 = source long address
;   $08-$09 = transfer size
;   $0A-$0B = pointer to next entry
;
; Raidenthequick: CODE_process_vram_dma_queue.
;
; INPUTS:   $0129 = queue index; queue at DATA_vram_dma_queue_pointers[$0129].
; OUTPUTS:  All entries DMA'd into VRAM; default queue's $4800 sentinel
;           reset to $4802.
; MODIFIES: A, X, Y; DBR pushed/popped; DMA channel 0 regs; $0129 reset.
; CALLERS:  every NMI/IRQ path that needs to flush VRAM writes.
;-------------------------------------------------------------------------
CODE_00E3DF:
CODE_process_vram_dma_queue:                       ; Raidenthequick: CODE_process_vram_dma_queue
	REP.b #$10
	LDX.w $0129
	LDY.w DATA_vram_dma_queue_pointers,x
	LDA.w DATA_vram_dma_queue_pointers+$02,x
	PHB
	PHA
	PLB
	STA.b $00
	REP.b #$20
	LDA.w $0000,y
	STA.b $04
	CMP.w #$4802
	BEQ.b CODE_00E443
	INY
	INY
CODE_00E3FD:
	LDA.w $0000,y
	STA.l !REGISTER_VRAMAddressLo
	LDA.w $0004,y
	STA.l DMA[$00].Destination
	LDA.w $0006,y
	STA.l DMA[$00].SourceHi
	LDA.w $0008,y
	STA.l DMA[$00].SizeLo
	LDA.w $0002,y
	SEP.b #$20
	STA.l !REGISTER_VRAMAddressIncrementValue
	XBA
	STA.l DMA[$00].Parameters
	LDA.b #$01
	STA.l !REGISTER_DMAEnable
	REP.b #$20
	LDA.w $000A,y
	TAY
	CMP.b $04
	BNE.b CODE_00E3FD
	LDA.l $000129
	BNE.b CODE_00E443
	LDA.w #$4802
	STA.w $7E4800
CODE_00E443:
	PLB
	STZ.w $0129
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; CODE_process_tilemap_dma_queue -- variable-length tilemap-DMA
; processor. Entry format is more flexible than CODE_process_vram_dma_queue's
; (used for the ROM-resident tilemap-init streams).
; Raidenthequick: CODE_process_tilemap_dma_queue.
;
; Entry format (variable length):
;   e[0:1] = VRAM dest (high bit = end-of-queue marker)
;   e[2:3] = vidt tttt tttt tttt
;            v = 1 -> column transfer (+$20 per cell); 0 -> row (+1)
;            i = 1 -> fixed-source (init/floodfill)
;            d = 1 -> read from VRAM (queue holds long DEST in e[4:6])
;            t = transfer size - 1
;   Read mode (d=1): 7-byte entry; e[4:6] = long destination.
;   Init mode (d=0, i=1): 6-byte entry; e[4:5] = word data to floodfill.
;   Write mode (d=0, i=0): (4 + t+1)-byte entry; e[4:?] = raw data.
;
; INPUTS:   A = queue bank (high byte goes to $00 + DBR); X = queue
;           address (within that bank).
; OUTPUTS:  Queue drained; PPU/DMA registers heavily clobbered.
; MODIFIES: A, X, Y; DBR pushed/popped; $00-$05 scratch; DMA channel 0;
;           VRAM at the per-entry destinations.
; CALLERS:  CODE_prepare_tilemap_dma_queue only.
;-------------------------------------------------------------------------
CODE_00E44A:
CODE_process_tilemap_dma_queue:                    ; Raidenthequick: CODE_process_tilemap_dma_queue
	PHB
	PHA
	PLB
	STA.b $00
	REP.b #$20
CODE_00E451:
	LDY.w $0000,x
	BPL.b CODE_00E45A
	SEP.b #$30
	PLB
	RTS

CODE_00E45A:
	LDA.w $0002,x
	AND.w #$1FFF
	INC
	STA.b $01
	STA.b $03
	LDA.w #$0080
	BIT.w $0002,x
	BPL.b CODE_00E470
	LDA.w #$0081
CODE_00E470:
	STA.l !REGISTER_VRAMAddressIncrementValue
	STA.b $05
	TYA
	STA.l !REGISTER_VRAMAddressLo
	LDA.w $0002,x
	AND.w #$2000
	BEQ.b CODE_00E49F
	LDA.w #$0003
	STA.b $03
	LDA.w $0004,x
	STA.l DMA[$00].SourceLo
	LDA.w $0005,x
	STA.l DMA[$00].SourceHi
	LDA.l !REGISTER_ReadFromVRAMPortLo
	LDA.w #((!REGISTER_ReadFromVRAMPortLo&$0000FF)<<8)+$81
	BRA.b CODE_00E4EB

CODE_00E49F:
	LDA.b $00
	STA.l DMA[$00].SourceBank
	LDY.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$01
	BVC.b CODE_00E4E1
	LSR.b $01
	LDA.w #$0002
	STA.b $03
	LDA.w #((!REGISTER_WriteToVRAMPortHi&$0000FF)<<8)+$08
	STA.l DMA[$00].Parameters
	TXA
	CLC
	ADC.w #$0005
	STA.l DMA[$00].SourceLo
	LDA.b $01
	STA.l DMA[$00].SizeLo
	LDA.w #$0100
	STA.l !REGISTER_VCountTimerHi
	LDA.b $05
	AND.w #$007F
	STA.l !REGISTER_VRAMAddressIncrementValue
	LDA.w $0000,x
	STA.l !REGISTER_VRAMAddressLo
	LDY.w #((!REGISTER_WriteToVRAMPortLo&$0000FF)<<8)+$08
CODE_00E4E1:
	TXA
	CLC
	ADC.w #$0004
	STA.l DMA[$00].SourceLo
	TYA
CODE_00E4EB:
	STA.l DMA[$00].Parameters
	LDA.b $01
	STA.l DMA[$00].SizeLo
	LDA.w #$0100
	STA.l !REGISTER_VCountTimerHi
	TXA
	CLC
	ADC.w #$0004
	ADC.b $03
	TAX
	JMP.w CODE_00E451

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; update_controllers (CODE_00E507 entry; update_controllers label at
; CODE_00E50F) -- spin until auto-joypad-read completes, then sample
; controllers 1 and 2 into RAM, compute "newly-pressed" edge masks, and
; mirror controller-1 to direct page.
; Raidenthequick: update_controllers.
;
; Edge detection: prev = $0944 (joy1) / $0946 (joy2); current = $093C /
; $0940; newly-pressed = (prev XOR current) AND current.
; Sanity: if any of the lower 4 bits ($000F, type ID) are set, the read
; is invalid (no controller) and current is forced to $0000.
;
; INPUTS:   PPU/CPU $4218 (Joypad1Lo) and $421A (Joypad2Lo) auto-read regs;
;           $4212 (HVBJOY) for the auto-joypad-busy poll.
; OUTPUTS:  $093C = joy1 raw; $093E = joy1 newly-pressed; $0944 = prev;
;           $0940 = joy2 raw; $0942 = joy2 newly-pressed; $0946 = prev;
;           DP $35 = joy1 raw mirror; DP $37 = joy1 newly-pressed mirror.
; MODIFIES: A, X, Y; M/X widths set to 16 on entry, reset to 8 on exit.
; CALLERS:  every NMI handler tail and one IRQ tail (CODE_00C194,
;           CODE_00C39E, CODE_00C57B, CODE_00C6F6, CODE_00D468, etc).
;-------------------------------------------------------------------------
CODE_00E507:
	LDA.w !REGISTER_HVBlankFlagsAndJoypadStatus
	LSR
	BCS.b CODE_00E507
	REP.b #$30
update_controllers:                           ; Raidenthequick: update_controllers
	LDA.w !REGISTER_Joypad1Lo
	BIT.w #$000F
	BEQ.b CODE_00E51A
	LDA.w #$0000
CODE_00E51A:
	STA.w $093C
	TAY
	EOR.w $0944
	AND.w $093C
	STA.w $093E
	STY.w $0944
	LDA.w !REGISTER_Joypad2Lo
	BIT.w #$000F
	BEQ.b CODE_00E535
	LDA.w #$0000
CODE_00E535:
	STA.w $0940
	TAY
	EOR.w $0946
	AND.w $0940
	STA.w $0942
	STY.w $0946
	LDA.w $093C
	STA.b $35
	LDA.w $093E
	STA.b $37
	SEP.b #$30
	RTS

;---------------------------------------------------------------------------

;-------------------------------------------------------------------------
; DATA_div_onebyx_lut -- 1024-byte reciprocal lookup table (512
; words of 1/X * $10000, scaled). Copied to SRAM $70:2200..25FF by
; CODE_copy_division_lookup_to_sram so the SuperFX-side code
; can look up divides without RDIV register stalls.
; Raidenthequick: DATA_div_onebyx_lut.
;-------------------------------------------------------------------------
DATA_00E552:
DATA_div_onebyx_lut:                               ; Raidenthequick: DATA_div_onebyx_lut
	dw $FFFF,$FFFF,$8000,$5555,$4000,$3333,$2AAA,$2492
	dw $2000,$1C71,$1999,$1745,$1555,$13B1,$1249,$1111
	dw $1000,$0F0F,$0E38,$0D79,$0CCC,$0C30,$0BA2,$0B21
	dw $0AAA,$0A3D,$09D8,$097B,$0924,$08D3,$0888,$0842
	dw $0800,$07C1,$0787,$0750,$071C,$06EB,$06BC,$0690
	dw $0666,$063E,$0618,$05F4,$05D1,$05B0,$0590,$0572
	dw $0555,$0539,$051E,$0505,$04EC,$04D4,$04BD,$04A7
	dw $0492,$047D,$0469,$0456,$0444,$0432,$0421,$0410
	dw $0400,$03F0,$03E0,$03D2,$03C3,$03B5,$03A8,$039B
	dw $038E,$0381,$0375,$0369,$035E,$0353,$0348,$033D
	dw $0333,$0329,$031F,$0315,$030C,$0303,$02FA,$02F1
	dw $02E8,$02E0,$02D8,$02D0,$02C8,$02C0,$02B9,$02B1
	dw $02AA,$02A3,$029C,$0295,$028F,$0288,$0282,$027C
	dw $0276,$0270,$026A,$0264,$025E,$0259,$0253,$024E
	dw $0249,$0243,$023E,$0239,$0234,$0230,$022B,$0226
	dw $0222,$021D,$0219,$0214,$0210,$020C,$0208,$0204
	dw $0200,$01FC,$01F8,$01F4,$01F0,$01EC,$01E9,$01E5
	dw $01E1,$01DE,$01DA,$01D7,$01D4,$01D0,$01CD,$01CA
	dw $01C7,$01C3,$01C0,$01BD,$01BA,$01B7,$01B4,$01B2
	dw $01AF,$01AC,$01A9,$01A6,$01A4,$01A1,$019E,$019C
	dw $0199,$0197,$0194,$0192,$018F,$018D,$018A,$0188
	dw $0186,$0183,$0181,$017F,$017D,$017A,$0178,$0176
	dw $0174,$0172,$0170,$016E,$016C,$016A,$0168,$0166
	dw $0164,$0162,$0160,$015E,$015C,$015A,$0158,$0157
	dw $0155,$0153,$0151,$0150,$014E,$014C,$014A,$0149
	dw $0147,$0146,$0144,$0142,$0141,$013F,$013E,$013C
	dw $013B,$0139,$0138,$0136,$0135,$0133,$0132,$0130
	dw $012F,$012E,$012C,$012B,$0129,$0128,$0127,$0125
	dw $0124,$0123,$0121,$0120,$011F,$011E,$011C,$011B
	dw $011A,$0119,$0118,$0116,$0115,$0114,$0113,$0112
	dw $0111,$010F,$010E,$010D,$010C,$010B,$010A,$0109
	dw $0108,$0107,$0106,$0105,$0104,$0103,$0102,$0101
	dw $0100,$00FF,$00FE,$00FD,$00FC,$00FB,$00FA,$00F9
	dw $00F8,$00F7,$00F6,$00F5,$00F4,$00F3,$00F2,$00F1
	dw $00F0,$00F0,$00EF,$00EE,$00ED,$00EC,$00EB,$00EA
	dw $00EA,$00E9,$00E8,$00E7,$00E6,$00E5,$00E5,$00E4
	dw $00E3,$00E2,$00E1,$00E1,$00E0,$00DF,$00DE,$00DE
	dw $00DD,$00DC,$00DB,$00DB,$00DA,$00D9,$00D9,$00D8
	dw $00D7,$00D6,$00D6,$00D5,$00D4,$00D4,$00D3,$00D2
	dw $00D2,$00D1,$00D0,$00D0,$00CF,$00CE,$00CE,$00CD
	dw $00CC,$00CC,$00CB,$00CA,$00CA,$00C9,$00C9,$00C8
	dw $00C7,$00C7,$00C6,$00C5,$00C5,$00C4,$00C4,$00C3
	dw $00C3,$00C2,$00C1,$00C1,$00C0,$00C0,$00BF,$00BF
	dw $00BE,$00BD,$00BD,$00BC,$00BC,$00BB,$00BB,$00BA
	dw $00BA,$00B9,$00B9,$00B8,$00B8,$00B7,$00B7,$00B6
	dw $00B6,$00B5,$00B5,$00B4,$00B4,$00B3,$00B3,$00B2
	dw $00B2,$00B1,$00B1,$00B0,$00B0,$00AF,$00AF,$00AE
	dw $00AE,$00AD,$00AD,$00AC,$00AC,$00AC,$00AB,$00AB
	dw $00AA,$00AA,$00A9,$00A9,$00A8,$00A8,$00A8,$00A7
	dw $00A7,$00A6,$00A6,$00A5,$00A5,$00A5,$00A4,$00A4
	dw $00A3,$00A3,$00A3,$00A2,$00A2,$00A1,$00A1,$00A1
	dw $00A0,$00A0,$009F,$009F,$009F,$009E,$009E,$009D
	dw $009D,$009D,$009C,$009C,$009C,$009B,$009B,$009A
	dw $009A,$009A,$0099,$0099,$0099,$0098,$0098,$0098
	dw $0097,$0097,$0097,$0096,$0096,$0095,$0095,$0095
	dw $0094,$0094,$0094,$0093,$0093,$0093,$0092,$0092
	dw $0092,$0091,$0091,$0091,$0090,$0090,$0090,$0090
	dw $008F,$008F,$008F,$008E,$008E,$008E,$008D,$008D
	dw $008D,$008C,$008C,$008C,$008C,$008B,$008B,$008B
	dw $008A,$008A,$008A,$0089,$0089,$0089,$0089,$0088
	dw $0088,$0088,$0087,$0087,$0087,$0087,$0086,$0086
	dw $0086,$0086,$0085,$0085,$0085,$0084,$0084,$0084
	dw $0084,$0083,$0083,$0083,$0083,$0082,$0082,$0082
	dw $0082,$0081,$0081,$0081,$0081,$0080,$0080,$0080
	dw $0080

; DATA_div_onebyx_lut_end -- 1024 bytes after DATA_div_onebyx_lut (used as the MVN
; size in CODE_copy_division_lookup_to_sram).
DATA_div_onebyx_lut_end:

;-------------------------------------------------------------------------
; DATA_cosine_lut_8bit_radians -- 64-entry cosine LUT, scaled so
; that cos(0) = $0100. Used by Raphael-the-Raven Mode-7 matrix setup
; (read by CODE_008E9A at $00:8E9A when shrinking eggshells and via
; SuperFX scratch path for boss orbit math).
;-------------------------------------------------------------------------
DATA_00E954:
DATA_cosine_lut_8bit_radians:
	dw $0100,$0100,$0100,$00FF,$00FF,$00FE,$00FD,$00FC
	dw $00FB,$00FA,$00F8,$00F7,$00F5,$00F3,$00F1,$00EF
	dw $00ED,$00EA,$00E7,$00E5,$00E2,$00DF,$00DC,$00D8
	dw $00D5,$00D1,$00CE,$00CA,$00C6,$00C2,$00BE,$00B9
	dw $00B5,$00B1,$00AC,$00A7,$00A2,$009D,$0098,$0093
	dw $008E,$0089,$0084,$007E,$0079,$0073,$006D,$0068
	dw $0062,$005C,$0056,$0050,$004A,$0044,$003E,$0038
	dw $0032,$002C,$0026,$001F,$0019,$0013,$000D,$0006

;-------------------------------------------------------------------------
; DATA_sine_lut_8bit_radians -- 256-entry sine LUT, scaled like
; the cosine table. Companion to cosine_lut for the same callers.
;-------------------------------------------------------------------------
DATA_00E9D4:
DATA_sine_lut_8bit_radians:
	dw $0000,$FFFA,$FFF3,$FFED,$FFE7,$FFE1,$FFDA,$FFD4
	dw $FFCE,$FFC8,$FFC2,$FFBC,$FFB6,$FFB0,$FFAA,$FFA4
	dw $FF9E,$FF98,$FF93,$FF8D,$FF87,$FF82,$FF7C,$FF77
	dw $FF72,$FF6D,$FF68,$FF63,$FF5E,$FF59,$FF54,$FF4F
	dw $FF4B,$FF47,$FF42,$FF3E,$FF3A,$FF36,$FF32,$FF2F
	dw $FF2B,$FF28,$FF24,$FF21,$FF1E,$FF1B,$FF19,$FF16
	dw $FF13,$FF11,$FF0F,$FF0D,$FF0B,$FF09,$FF08,$FF06
	dw $FF05,$FF04,$FF03,$FF02,$FF01,$FF01,$FF00,$FF00
	dw $FF00,$FF00,$FF00,$FF01,$FF01,$FF02,$FF03,$FF04
	dw $FF05,$FF06,$FF08,$FF09,$FF0B,$FF0D,$FF0F,$FF11
	dw $FF13,$FF16,$FF19,$FF1B,$FF1E,$FF21,$FF24,$FF28
	dw $FF2B,$FF2F,$FF32,$FF36,$FF3A,$FF3E,$FF42,$FF47
	dw $FF4B,$FF4F,$FF54,$FF59,$FF5E,$FF63,$FF68,$FF6D
	dw $FF72,$FF77,$FF7C,$FF82,$FF87,$FF8D,$FF93,$FF98
	dw $FF9E,$FFA4,$FFAA,$FFB0,$FFB6,$FFBC,$FFC2,$FFC8
	dw $FFCE,$FFD4,$FFDA,$FFE1,$FFE7,$FFED,$FFF3,$FFFA
	dw $0000,$0006,$000D,$0013,$0019,$001F,$0026,$002C
	dw $0032,$0038,$003E,$0044,$004A,$0050,$0056,$005C
	dw $0062,$0068,$006D,$0073,$0079,$007E,$0084,$0089
	dw $008E,$0093,$0098,$009D,$00A2,$00A7,$00AC,$00B1
	dw $00B5,$00B9,$00BE,$00C2,$00C6,$00CA,$00CE,$00D1
	dw $00D5,$00D8,$00DC,$00DF,$00E2,$00E5,$00E7,$00EA
	dw $00ED,$00EF,$00F1,$00F3,$00F5,$00F7,$00F8,$00FA
	dw $00FB,$00FC,$00FD,$00FE,$00FF,$00FF,$0100,$0100
	dw $0100,$0100,$0100,$00FF,$00FF,$00FE,$00FD,$00FC
	dw $00FB,$00FA,$00F8,$00F7,$00F5,$00F3,$00F1,$00EF
	dw $00ED,$00EA,$00E7,$00E5,$00E2,$00DF,$00DC,$00D8
	dw $00D5,$00D1,$00CE,$00CA,$00C6,$00C2,$00BE,$00B9
	dw $00B5,$00B1,$00AC,$00A7,$00A2,$009D,$0098,$0093
	dw $008E,$0089,$0084,$007E,$0079,$0073,$006D,$0068
	dw $0062,$005C,$0056,$0050,$004A,$0044,$003E,$0038
	dw $0032,$002C,$0026,$001F,$0019,$0013,$000D,$0006

DATA_level_10_obj:
	incbin "LevelData/DATA_level_10_obj.bin"

DATA_level_48_obj:
	incbin "LevelData/DATA_level_48_obj.bin"

DATA_level_78_obj:
	incbin "LevelData/DATA_level_78_obj.bin"

DATA_level_A1_obj:
	incbin "LevelData/DATA_level_A1_obj.bin"

DATA_level_BE_obj:
	incbin "LevelData/DATA_level_BE_obj.bin"

DATA_level_C8_obj:
	incbin "LevelData/DATA_level_C8_obj.bin"

DATA_level_CF_obj:
	incbin "LevelData/DATA_level_CF_obj.bin"

DATA_level_D4_obj:
	incbin "LevelData/DATA_level_D4_obj.bin"

DATA_level_10_spr:
	incbin "LevelData/DATA_level_10_spr.bin"

DATA_level_48_spr:
	incbin "LevelData/DATA_level_48_spr.bin"

DATA_level_78_spr:
	incbin "LevelData/DATA_level_78_spr.bin"

DATA_level_A1_spr:
	incbin "LevelData/DATA_level_A1_spr.bin"

DATA_level_BE_spr:
	incbin "LevelData/DATA_level_BE_spr.bin"

DATA_level_C8_spr:
	incbin "LevelData/DATA_level_C8_spr.bin"

DATA_level_CF_spr:
	incbin "LevelData/DATA_level_CF_spr.bin"

DATA_level_D4_spr:
	incbin "LevelData/DATA_level_D4_spr.bin"

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($00F7A7, incbin, DATA_00F7A7_YI_U2.bin)
else
	%FREE_BYTES($00F7A7, 2041, $FF)
endif

UNK_00FFA0:
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	db $95,$09,$27,$10,$03
else
	db $95,$07,$31,$11,$19
endif

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($00FFA5, incbin, DATA_00FFA5_YI_U2.bin)
else
	%FREE_BYTES($00FFA5, 11, $FF)
endif
%BANK_END(<EndBank>)
endmacro
