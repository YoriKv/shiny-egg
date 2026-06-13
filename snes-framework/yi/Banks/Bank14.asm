;#############################################################################################################
;# Bank14.asm -- LoROM bank $14 (cart bank $14). Pure level-data bank: 95 per-level
;#               object/sprite stream blobs included as raw .bin files. Each DATA_14XXXX
;#               label is referenced from the level pointer table (Ptrs:) emitted by
;#               Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm; pairs of adjacent
;#               labels are typically (object-stream, sprite-stream) for one level slot.
;#
;# No 65816 code in this bank; nothing to JSR/JMP to. The level engine LDA.l's into these
;# bytes via the pointer table only.
;#
;# Cross-references:
;#   yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm -- Ptrs: consumer.
;#   yi/assets/yi/LevelData/                                   -- the included .bin files.
;#   docs/levelloader.md S3                                    -- pointer-table semantics
;#       (222 entries x 6 bytes = `dl object_ptr, sprite_ptr`; indexed by runtime level-ID byte;
;#       lives at $17:F7C3 on V1.0 or $0F:E822 on V1.1).
;#   yoshisisland-disassembly/disassembly/bank14.asm           -- Raidenthequick names the
;#       blobs by "level-XX-obj/spr.bin"; our DATA_14XXXX -> level-NN mapping is implicit
;#       in the asm-as-truth source: trace the address through Ptrs: to find the level ID.
;#
;# File layout (start-of-bank -> end-of-bank, all .bin payloads):
;#############################################################################################################
macro YIBank14Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

DATA_level_03_obj:
	incbin "LevelData/DATA_level_03_obj.bin"

DATA_level_3D_obj:
	incbin "LevelData/DATA_level_3D_obj.bin"

DATA_level_6E_obj:
	incbin "LevelData/DATA_level_6E_obj.bin"

DATA_level_99_obj:
	incbin "LevelData/DATA_level_99_obj.bin"

DATA_level_03_spr:
	incbin "LevelData/DATA_level_03_spr.bin"

DATA_level_3D_spr:
	incbin "LevelData/DATA_level_3D_spr.bin"

DATA_level_6E_spr:
	incbin "LevelData/DATA_level_6E_spr.bin"

DATA_level_99_spr:
	incbin "LevelData/DATA_level_99_spr.bin"

DATA_level_0A_obj:
	incbin "LevelData/DATA_level_0A_obj.bin"

DATA_level_42_obj:
	incbin "LevelData/DATA_level_42_obj.bin"

DATA_level_72_obj:
	incbin "LevelData/DATA_level_72_obj.bin"

DATA_level_0A_spr:
	incbin "LevelData/DATA_level_0A_spr.bin"

DATA_level_42_spr:
	incbin "LevelData/DATA_level_42_spr.bin"

DATA_level_72_spr:
	incbin "LevelData/DATA_level_72_spr.bin"

DATA_level_0F_obj:
	incbin "LevelData/DATA_level_0F_obj.bin"

DATA_level_47_obj:
	incbin "LevelData/DATA_level_47_obj.bin"

DATA_level_77_obj:
	incbin "LevelData/DATA_level_77_obj.bin"

DATA_level_A0_obj:
	incbin "LevelData/DATA_level_A0_obj.bin"

DATA_level_0F_spr:
	incbin "LevelData/DATA_level_0F_spr.bin"

DATA_level_47_spr:
	incbin "LevelData/DATA_level_47_spr.bin"

DATA_level_77_spr:
	incbin "LevelData/DATA_level_77_spr.bin"

DATA_level_A0_spr:
	incbin "LevelData/DATA_level_A0_spr.bin"

DATA_level_12_obj:
	incbin "LevelData/DATA_level_12_obj.bin"

DATA_level_4A_obj:
	incbin "LevelData/DATA_level_4A_obj.bin"

DATA_level_79_obj:
	incbin "LevelData/DATA_level_79_obj.bin"

DATA_level_A2_obj:
	incbin "LevelData/DATA_level_A2_obj.bin"

DATA_level_12_spr:
	incbin "LevelData/DATA_level_12_spr.bin"

DATA_level_4A_spr:
	incbin "LevelData/DATA_level_4A_spr.bin"

DATA_level_79_spr:
	incbin "LevelData/DATA_level_79_spr.bin"

DATA_level_A2_spr:
	incbin "LevelData/DATA_level_A2_spr.bin"

DATA_level_13_obj:
	incbin "LevelData/DATA_level_13_obj.bin"

DATA_level_4B_obj:
	incbin "LevelData/DATA_level_4B_obj.bin"

DATA_level_13_spr:
	incbin "LevelData/DATA_level_13_spr.bin"

DATA_level_4B_spr:
	incbin "LevelData/DATA_level_4B_spr.bin"

DATA_level_14_obj:
	incbin "LevelData/DATA_level_14_obj.bin"

DATA_level_4C_obj:
	incbin "LevelData/DATA_level_4C_obj.bin"

DATA_level_7A_obj:
	incbin "LevelData/DATA_level_7A_obj.bin"

DATA_level_14_spr:
	incbin "LevelData/DATA_level_14_spr.bin"

DATA_level_4C_spr:
	incbin "LevelData/DATA_level_4C_spr.bin"

DATA_level_7A_spr:
	incbin "LevelData/DATA_level_7A_spr.bin"

DATA_level_19_obj:
	incbin "LevelData/DATA_level_19_obj.bin"

DATA_level_51_obj:
	incbin "LevelData/DATA_level_51_obj.bin"

DATA_level_7F_obj:
	incbin "LevelData/DATA_level_7F_obj.bin"

DATA_level_A7_obj:
	incbin "LevelData/DATA_level_A7_obj.bin"

DATA_level_51_spr:
	incbin "LevelData/DATA_level_51_spr.bin"
DATA_14C6C6:							; zero-size alias; Ptrs[$19] references DATA_14C6C6-$02. Record
								; $19 is 3-8 "Naval Piranha's Castle" -- NOT map slot $19
								; JungleRhythm (slot $19 plays record $13; see LevelIDs.asm
								; ID-SPACE WARNING). The actual sprite-stream address is $14C6C4,
								; inside the preceding incbin -- DATA_level_51_spr.bin -- at
								; offset $EB. Editor sees DATA_level_19_spr.bin (2 bytes = $FFFF
								; terminator, meaning the cart's record $19 has 0 sprites). Same
								; vestigial-header pattern as Bank16's DATA_16F097.
	;dw $FFFF

DATA_level_7F_spr:
	incbin "LevelData/DATA_level_7F_spr.bin"

DATA_level_A7_spr:
	incbin "LevelData/DATA_level_A7_spr.bin"

DATA_level_1B_obj:
	incbin "LevelData/DATA_level_1B_obj.bin"

DATA_level_52_obj:
	incbin "LevelData/DATA_level_52_obj.bin"

DATA_level_80_obj:
	incbin "LevelData/DATA_level_80_obj.bin"

DATA_level_A8_obj:
	incbin "LevelData/DATA_level_A8_obj.bin"

DATA_level_1B_spr:
	incbin "LevelData/DATA_level_1B_spr.bin"

DATA_level_52_spr:
	incbin "LevelData/DATA_level_52_spr.bin"

DATA_level_80_spr:
	incbin "LevelData/DATA_level_80_spr.bin"

DATA_level_A8_spr:
	incbin "LevelData/DATA_level_A8_spr.bin"

DATA_level_1C_obj:
	incbin "LevelData/DATA_level_1C_obj.bin"

DATA_level_53_obj:
	incbin "LevelData/DATA_level_53_obj.bin"

DATA_level_81_obj:
	incbin "LevelData/DATA_level_81_obj.bin"

DATA_level_A9_obj:
	incbin "LevelData/DATA_level_A9_obj.bin"

DATA_level_1C_spr:
	incbin "LevelData/DATA_level_1C_spr.bin"

DATA_level_53_spr:
	incbin "LevelData/DATA_level_53_spr.bin"

DATA_level_81_spr:
	incbin "LevelData/DATA_level_81_spr.bin"

DATA_level_A9_spr:
	incbin "LevelData/DATA_level_A9_spr.bin"

DATA_level_1F_obj:
	incbin "LevelData/DATA_level_1F_obj.bin"

DATA_level_56_obj:
	incbin "LevelData/DATA_level_56_obj.bin"

DATA_level_83_obj:
	incbin "LevelData/DATA_level_83_obj.bin"

DATA_level_1F_spr:
	incbin "LevelData/DATA_level_1F_spr.bin"

DATA_level_56_spr:
	incbin "LevelData/DATA_level_56_spr.bin"

DATA_level_83_spr:
	incbin "LevelData/DATA_level_83_spr.bin"

DATA_level_25_obj:
	incbin "LevelData/DATA_level_25_obj.bin"

DATA_level_5C_obj:
	incbin "LevelData/DATA_level_5C_obj.bin"

DATA_level_88_obj:
	incbin "LevelData/DATA_level_88_obj.bin"

DATA_level_AE_obj:
	incbin "LevelData/DATA_level_AE_obj.bin"

DATA_level_25_spr:
	incbin "LevelData/DATA_level_25_spr.bin"

DATA_level_5C_spr:
	incbin "LevelData/DATA_level_5C_spr.bin"

DATA_level_88_spr:
	incbin "LevelData/DATA_level_88_spr.bin"

DATA_level_AE_spr:
	incbin "LevelData/DATA_level_AE_spr.bin"

DATA_level_33_obj:
	incbin "LevelData/DATA_level_33_obj.bin"

DATA_level_6A_obj:
	incbin "LevelData/DATA_level_6A_obj.bin"

DATA_level_96_obj:
	incbin "LevelData/DATA_level_96_obj.bin"

DATA_level_B7_obj:
	incbin "LevelData/DATA_level_B7_obj.bin"

DATA_level_33_spr:
	incbin "LevelData/DATA_level_33_spr.bin"

DATA_level_6A_spr:
	incbin "LevelData/DATA_level_6A_spr.bin"

DATA_level_96_spr:
	incbin "LevelData/DATA_level_96_spr.bin"

DATA_level_B7_spr:
	incbin "LevelData/DATA_level_B7_spr.bin"

DATA_level_36_obj:
	incbin "LevelData/DATA_level_36_obj.bin"

DATA_level_37_obj:
	incbin "LevelData/DATA_level_37_obj.bin"

DATA_level_36_spr:
	incbin "LevelData/DATA_level_36_spr.bin"

DATA_level_37_spr:
	incbin "LevelData/DATA_level_37_spr.bin"

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($14FFA5, incbin, DATA_14FFA5_YI_U2.bin)	; V1.1: extra payload here
else
	%FREE_BYTES($14FFA5, 91, $FF)				; V1.0: 91-byte $FF tail
endif
%BANK_END(<EndBank>)
endmacro
