;#############################################################################################################
;# ROUTINE_YI_NorSpr03E_ThinPlatform.asm
;#
;# Init/Main handlers for normal sprite ID $03E -- the "thin platform" (a.k.a. "skinny
;# platform" in Raidenthequick's labels). These are the narrow horizontal floating
;# platforms that bend/tilt under Yoshi's weight using SuperFX-assisted physics.
;#
;# Emit sites (only ONE of these compiles per build, version-gated by !ROM_YI_U2):
;#   yi/Banks/Bank00.asm:1239    %ROUTINE_YI_NorSpr03E_ThinPlatform($00878A)  -- V1.0  (Init at $00:878A, Main at $00:878E)
;#   yi/Banks/Bank0F.asm:2689    %ROUTINE_YI_NorSpr03E_ThinPlatform($0F94D6)  -- V1.1
;#
;# Cross-references:
;#   docs/spritestateengine.md                            -- sprite engine architecture
;#       (sprite ID space, the per-sprite Init/Main pointer-table convention, and the four
;#       state-keyed dispatch tables consumed by CODE_handle_sprite).
;#   yoshisisland-disassembly/disassembly/bank00.asm:1013..1297
;#                                                        -- Raidenthequick V1.0 names `init_skinny_platform`
;#                                                           and `main_skinny_platform`.
;#   yoshisisland-disassembly/docs/named_main_labels.txt  -- index entry "init_skinny_platform / main_skinny_platform".
;#
;# Mechanism:
;#   - Eight bytes of per-sprite shape state (s_spr_gsu_morph_1/2_lo/hi + wildcard_1/2_lo/hi) hold
;#     the displacement of 8 sample points along the platform's length. Each frame those values
;#     are mirrored into both OAM Y-offsets and SuperFX scratchpad RAM ($6000+).
;#   - When Yoshi stands on the platform, the SuperFX routine at FXCODE_0B860A is invoked to
;#     compute new platform deflection from the player's X/Y position and momentum (REGISTER_SuperFX_R1..R10).
;#   - Without Yoshi, the sample points relax toward zero with a simple decay (CODE_thin_platform_relax_to_zero/CODE_00891C).
;#
;# Memory map (s_spr_* are sprite-table per-x offsets; see yi/Memory/):
;#     $78,x   (DP)   wildcard_4_lo_dp -- Yoshi-on-platform contact flag / Y-offset transferred to player
;#     $7400,x        s_spr_facing_dir -- 0 by Init (the platform has no facing)
;#     $7362,x        s_spr_oam_pointer -- where to write the 8 sample OAM-Y offsets
;#     $7A36..$7A39,x s_spr_gsu_morph_1_lo..hi / s_spr_gsu_morph_2_lo..hi -- first 4 sample points
;#     $701900..3,x   wildcard_1_lo/hi, wildcard_2_lo/hi -- last 4 sample points (in ExRAM)
;#     $61B4          s_on_sprite_platform_flag -- incremented when player lands on platform
;#############################################################################################################
macro ROUTINE_YI_NorSpr03E_ThinPlatform(Address)
namespace YI_NorSpr03E_ThinPlatform
%InsertMacroAtXPosition(<Address>)

;-------------------------------------------------------------------------
; Init -- run once on sprite spawn.
; Raidenthequick: `init_skinny_platform` at $00:878A.
; Just zeroes the facing-direction byte (the platform has no facing); the
; 8 sample points are spawned at their level-data initial values.
;-------------------------------------------------------------------------
Init:
init_skinny_platform:             ; Raidenthequick: init_skinny_platform
	STZ.w $7400,x                 ;   s_spr_facing_dir = 0
	RTL

;-------------------------------------------------------------------------
; Main -- run every frame the sprite is active.
; Raidenthequick: `main_skinny_platform` at $00:878E.
; Two-phase structure:
;   Phase 1 ($00878E..$0087FA): mirror current 8 sample-Y values into OAM (so the
;     platform sprites bend visually) and propagate Yoshi-on-platform Y-offset.
;   Phase 2 ($00880B..$00899F): compute next-frame sample values. If Yoshi is on
;     the platform, SuperFX physics (FXCODE_0B860A) is invoked; otherwise the
;     samples relax toward zero. Final values written back at $00899F.
;-------------------------------------------------------------------------
Main:
main_skinny_platform:             ; Raidenthequick: main_skinny_platform
	REP.b #$10
	LDY.w $7362,x
	LDA.w $7682,x
	STA.b $00
	LDA.w $7A36,x
	AND.w #$00FF
	CLC
	ADC.b $00
	STA.w $6002,y
	LDA.w $7A37,x
	AND.w #$00FF
	CLC
	ADC.b $00
	STA.w $600A,y
	LDA.w $7A38,x
	AND.w #$00FF
	CLC
	ADC.b $00
	STA.w $6012,y
	LDA.w $7A39,x
	AND.w #$00FF
	CLC
	ADC.b $00
	STA.w $601A,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$00FF
	CLC
	ADC.b $00
	STA.w $6022,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	AND.w #$00FF
	CLC
	ADC.b $00
	STA.w $602A,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$00FF
	CLC
	ADC.b $00
	STA.w $6032,y
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	AND.w #$00FF
	CLC
	ADC.b $00
	STA.w $603A,y
	SEP.b #$10
	LDA.w $60FC
	AND.w #$0003
	BNE.b CODE_thin_platform_phase2_pack_samples
	LDA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	CLC
	ADC.b $18,x
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
;-- CODE_thin_platform_phase2_pack_samples: phase 2 entry. Pack the 8 sample-Y bytes into SuperFX scratch
;   ($6000..$600E word-aligned) and shadow copies in direct-page ($00..$0E).
CODE_00880B:
CODE_thin_platform_phase2_pack_samples: ; pack 8 sample-Y bytes -> SuperFX scratch + DP shadow
	LDA.w $7A36,x
	AND.w #$00FF
	STA.w $6000
	STA.b $00
	LDA.w $7A37,x
	AND.w #$00FF
	STA.w $6002
	STA.b $02
	LDA.w $7A38,x
	AND.w #$00FF
	STA.w $6004
	STA.b $04
	LDA.w $7A39,x
	AND.w #$00FF
	STA.w $6006
	STA.b $06
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	AND.w #$00FF
	STA.w $6008
	STA.b $08
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	AND.w #$00FF
	STA.w $600A
	STA.b $0A
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	AND.w #$00FF
	STA.w $600C
	STA.b $0C
	LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	AND.w #$00FF
	STA.w $600E
	STA.b $0E
	STZ.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo
	LDY.w $60AB
	BPL.b CODE_008870
	LDY.w $60C0
	BNE.b CODE_0088C7
CODE_008870:
	LDA.w $611C
	SEC
	SBC.w $70E2,x
	CLC
	ADC.w #$0020
	CMP.w #$0040
	BCS.b CODE_thin_platform_relax_to_zero
	STA.w !REGISTER_SuperFX_R2_PLOTYCoordinateLo
	LDA.w $70E2,x
	SEC
	SBC.w #$0018
	SEC
	SBC.w $611C
	STA.w !REGISTER_SuperFX_R3_GeneralPurposeLo
	LDA.w #$0046
	CLC
	ADC.b $78,x
	STA.w $603E
	LSR
	STA.w $603C
	STA.w !REGISTER_SuperFX_R6_MultiplierLo
	LDA.w $611E
	CLC
	ADC.w $6112
	STA.w !REGISTER_SuperFX_R8_MERGEYPosLo
	LDA.w $6122
	STA.w !REGISTER_SuperFX_R9_GeneralPurpose3Lo
	LDA.w $7182,x
	STA.w !REGISTER_SuperFX_R10_GeneralPurpose4Lo
	LDX.b #FXCODE_0B860A>>16      ; \ kick SuperFX: bank of FXCODE_0B860A
	LDA.w #FXCODE_0B860A          ;  | offset of routine entry
	JSL.l !RAM_YI_Global_BeginSuperFXProcessingRt ; / r1..r10 already loaded above
	LDX.b $12                     ; restore X = sprite slot
	LDY.w !REGISTER_SuperFX_R1_PLOTXCoordinateLo ; SuperFX returns 0 in r1 = no contact
	BNE.b CODE_thin_platform_bend_down             ; nonzero = Yoshi standing on platform: fall through to physics
CODE_0088C7:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_thin_platform_relax_to_zero
	JMP.w CODE_thin_platform_writeback_samples

;-- CODE_thin_platform_relax_to_zero: Yoshi NOT on platform. Relax all 8 sample points toward 0 by
;   subtracting max($8, sample/8) per frame. Loop counter Y goes 14, 12, ..., 0.
CODE_0088CF:
CODE_thin_platform_relax_to_zero:      ; no-contact: relax 8 sample points toward 0 each frame
	LDY.b #$0E
CODE_0088D1:
	LDA.w $7960,y
	BEQ.b CODE_0088EC
	CMP.w #$0008
	BPL.b CODE_0088DE
	LDA.w #$0008
CODE_0088DE:
	LSR
	LSR
	LSR
	EOR.w #$FFFF
	INC
	CLC
	ADC.w $7960,y
	STA.w $7960,y
CODE_0088EC:
	DEY
	DEY
	BPL.b CODE_0088D1
	STZ.b $18,x
	JMP.w CODE_008985

;-- CODE_thin_platform_bend_down: Yoshi on platform, with downward velocity. Each sample point
;   moves toward (sample + diff/2) where diff = SuperFX-computed target ($6000+).
CODE_0088F5:
CODE_thin_platform_bend_down:          ; on platform + falling: each sample -> midpoint(sample, target)
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_thin_platform_settle
	LDY.b #$0E
CODE_0088FC:
	LDA.w $6000,y
	SEC
	SBC.w $7960,y
	BMI.b CODE_008914
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CLC
	ADC.w $7960,y
	STA.w $7960,y
CODE_008914:
	DEY
	DEY
	BPL.b CODE_0088FC
	BRA.b CODE_008936

;-- CODE_thin_platform_settle: Yoshi on platform, NOT falling. Identical relaxation math to
;   CODE_0088FC but without the BMI early-exit (no downward bias).
CODE_00891A:
CODE_thin_platform_settle:             ; on platform, not falling: relaxation without downward bias
	LDY.b #$0E
CODE_00891C:
	LDA.w $6000,y
	SEC
	SBC.w $7960,y
	CMP.w #$8000
	ROR
	CMP.w #$8000
	ROR
	CLC
	ADC.w $7960,y
	STA.w $7960,y
	DEY
	DEY
	BPL.b CODE_00891C
CODE_008936:
	LDY.b $18,x
	BNE.b CODE_00894F
	LDA.w $60AA
	LSR
	LSR
	LSR
	LSR
	STA.b $78,x
	LDY.w $60D4
	BEQ.b CODE_00894F
	LDA.w $60AA
	LSR
	STA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
CODE_00894F:
	LDA.w $60FC
	AND.w #$0003
	BNE.b CODE_008985
	LDA.w $6020
	AND.w #$FFFE
	TAY
	LDA.w $7960,y
	CLC
	ADC.w $7182,x
	SEC
	SBC.w #$001E
	SEC
	SBC.w $6112
	STA.w !EXRAM_YI_Player_YPosLo|!EXRAMBankMirror
	STZ.w $60AA
	INC.w $61B4
	LDY.b #$02
	STY.b $18,x
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_008985
	LDA.w #$0800
	STA.w $60AA
CODE_008985:
	LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo|!EXRAMBankMirror,x
	BEQ.b CODE_008992
	LDA.b $78,x
	CLC
	ADC.w #$0004
	BRA.b CODE_00899D

CODE_008992:
	LDA.b $78,x
	SEC
	SBC.w #$0008
	BPL.b CODE_00899D
	LDA.w #$0000
CODE_00899D:
	STA.b $78,x
;-- CODE_thin_platform_writeback_samples: writeback. Copy the 8 updated sample values from direct page
;   ($00..$0E) back into per-sprite state. Wrapped in SEP/REP to do 8-bit byte
;   writes (sample values are bytes; the prior phases used them as words).
CODE_00899F:
CODE_thin_platform_writeback_samples:  ; copy 8 updated sample values from DP back to per-sprite state
	SEP.b #$20
	LDA.b $00
	STA.w $7A36,x
	LDA.b $02
	STA.w $7A37,x
	LDA.b $04
	STA.w $7A38,x
	LDA.b $06
	STA.w $7A39,x
	LDA.b $08
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701900|!EXRAMBankMirror,x
	LDA.b $0A
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701901|!EXRAMBankMirror,x
	LDA.b $0C
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701902|!EXRAMBankMirror,x
	LDA.b $0E
	STA.w !EXRAM_YI_Level_NorSpr_GenericTable701903|!EXRAMBankMirror,x
	REP.b #$20
	RTL

namespace off
endmacro
