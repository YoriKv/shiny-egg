;#############################################################################################################
;# Bank16.asm -- LoROM bank $16. Pure level-data bank (~75 per-level object/sprite stream
;#               blobs included as raw .bin files). Same semantics as Bank14/Bank15: each
;#               DATA_16XXXX label is consumed by the Ptrs: table from
;#               Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm.
;#
;# Note: DATA_16F097 is a zero-byte label (no incbin between it and DATA_16F099) -- it's a
;# pure alias that lets the pointer table reference an offset two bytes before DATA_16F099.
;# The Ptrs: entry uses `DATA_16F097-$02` to compensate; do NOT remove the bare label.
;#
;# Cross-references:
;#   yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm
;#   yoshisisland-disassembly/disassembly/bank16.asm
;#############################################################################################################
macro YIBank16Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

DATA_level_38_obj:
	incbin "LevelData/DATA_level_38_obj.bin"

DATA_level_39_obj:
	incbin "LevelData/DATA_level_39_obj.bin"

DATA_level_00_obj:
	incbin "LevelData/DATA_level_00_obj.bin"

DATA_level_3A_obj:
	incbin "LevelData/DATA_level_3A_obj.bin"

DATA_level_38_spr:
	incbin "LevelData/DATA_level_38_spr.bin"

DATA_level_39_spr:
	incbin "LevelData/DATA_level_39_spr.bin"

DATA_level_00_spr:
	incbin "LevelData/DATA_level_00_spr.bin"

DATA_level_3A_spr:
	incbin "LevelData/DATA_level_3A_spr.bin"

DATA_level_02_obj:
	incbin "LevelData/DATA_level_02_obj.bin"

DATA_level_3C_obj:
	incbin "LevelData/DATA_level_3C_obj.bin"

DATA_level_6D_obj:
	incbin "LevelData/DATA_level_6D_obj.bin"

DATA_level_02_spr:
	incbin "LevelData/DATA_level_02_spr.bin"

DATA_level_3C_spr:
	incbin "LevelData/DATA_level_3C_spr.bin"

DATA_level_6D_spr:
	incbin "LevelData/DATA_level_6D_spr.bin"

DATA_level_08_obj:
	incbin "LevelData/DATA_level_08_obj.bin"

DATA_level_08_spr:
	incbin "LevelData/DATA_level_08_spr.bin"

DATA_level_17_obj:
	incbin "LevelData/DATA_level_17_obj.bin"

DATA_level_4F_obj:
	incbin "LevelData/DATA_level_4F_obj.bin"

DATA_169D23:							; level $7D obj stream. Kept as DATA_169D23 (not renamed to
								; DATA_level_7D_obj) because the cart's actual stream is 366 bytes
								; -- extending past this incbin's 225-byte slice into what the asm
								; calls DATA_169E04 + DATA_169E75. A per-level rename would push
								; Bank16's subsequent labels by 141 bytes and overflow the 32KB
								; bank. Editor's DATA_level_7D_obj.bin (366 bytes) is the source
								; of truth for level reads; write-back to this 225-byte slice +
								; the absorbed adjacent .bins is handled out-of-band.
	incbin "LevelData/DATA_169D23.bin"

DATA_level_A5_obj:
	incbin "LevelData/DATA_level_A5_obj.bin"

DATA_level_17_spr:
	incbin "LevelData/DATA_level_17_spr.bin"

DATA_level_4F_spr:
	incbin "LevelData/DATA_level_4F_spr.bin"

DATA_level_7D_spr:
	incbin "LevelData/DATA_level_7D_spr.bin"

DATA_level_A5_spr:
	incbin "LevelData/DATA_level_A5_spr.bin"

DATA_level_18_obj:
	incbin "LevelData/DATA_level_18_obj.bin"

DATA_level_50_obj:
	incbin "LevelData/DATA_level_50_obj.bin"

DATA_level_7E_obj:
	incbin "LevelData/DATA_level_7E_obj.bin"

DATA_level_A6_obj:
	incbin "LevelData/DATA_level_A6_obj.bin"

DATA_level_C0_obj:
	incbin "LevelData/DATA_level_C0_obj.bin"

DATA_level_18_spr:
	incbin "LevelData/DATA_level_18_spr.bin"

DATA_level_50_spr:
	incbin "LevelData/DATA_level_50_spr.bin"

DATA_level_7E_spr:
	incbin "LevelData/DATA_level_7E_spr.bin"

DATA_level_A6_spr:
	incbin "LevelData/DATA_level_A6_spr.bin"

DATA_level_C0_spr:
	incbin "LevelData/DATA_level_C0_spr.bin"

DATA_level_20_obj:
	incbin "LevelData/DATA_level_20_obj.bin"

DATA_level_57_obj:
	incbin "LevelData/DATA_level_57_obj.bin"

DATA_level_84_obj:
	incbin "LevelData/DATA_level_84_obj.bin"

DATA_level_AB_obj:
	incbin "LevelData/DATA_level_AB_obj.bin"

DATA_level_20_spr:
	incbin "LevelData/DATA_level_20_spr.bin"

DATA_level_57_spr:
	incbin "LevelData/DATA_level_57_spr.bin"

DATA_level_84_spr:
	incbin "LevelData/DATA_level_84_spr.bin"

DATA_level_AB_spr:
	incbin "LevelData/DATA_level_AB_spr.bin"

DATA_level_22_obj:
	incbin "LevelData/DATA_level_22_obj.bin"

DATA_level_59_obj:
	incbin "LevelData/DATA_level_59_obj.bin"

DATA_level_86_obj:
	incbin "LevelData/DATA_level_86_obj.bin"

DATA_level_AC_obj:
	incbin "LevelData/DATA_level_AC_obj.bin"

DATA_level_22_spr:
	incbin "LevelData/DATA_level_22_spr.bin"

DATA_level_59_spr:
	incbin "LevelData/DATA_level_59_spr.bin"

DATA_level_86_spr:
	incbin "LevelData/DATA_level_86_spr.bin"

DATA_level_AC_spr:
	incbin "LevelData/DATA_level_AC_spr.bin"

DATA_level_27_obj:
	incbin "LevelData/DATA_level_27_obj.bin"

DATA_level_5E_obj:
	incbin "LevelData/DATA_level_5E_obj.bin"

DATA_level_8A_obj:
	incbin "LevelData/DATA_level_8A_obj.bin"

DATA_level_B0_obj:
	incbin "LevelData/DATA_level_B0_obj.bin"

DATA_level_27_spr:
	incbin "LevelData/DATA_level_27_spr.bin"

DATA_level_5E_spr:
	incbin "LevelData/DATA_level_5E_spr.bin"

DATA_level_8A_spr:
	incbin "LevelData/DATA_level_8A_spr.bin"

DATA_level_B0_spr:
	incbin "LevelData/DATA_level_B0_spr.bin"

DATA_level_28_obj:
	incbin "LevelData/DATA_level_28_obj.bin"

DATA_level_5F_obj:
	incbin "LevelData/DATA_level_5F_obj.bin"

DATA_level_8B_obj:
	incbin "LevelData/DATA_level_8B_obj.bin"

DATA_level_B1_obj:
	incbin "LevelData/DATA_level_B1_obj.bin"

DATA_level_28_spr:
	incbin "LevelData/DATA_level_28_spr.bin"

DATA_level_5F_spr:
	incbin "LevelData/DATA_level_5F_spr.bin"

DATA_level_8B_spr:
	incbin "LevelData/DATA_level_8B_spr.bin"

DATA_level_B1_spr:
	incbin "LevelData/DATA_level_B1_spr.bin"

DATA_level_2B_obj:
	incbin "LevelData/DATA_level_2B_obj.bin"

DATA_level_62_obj:
	incbin "LevelData/DATA_level_62_obj.bin"

DATA_level_8E_obj:
	incbin "LevelData/DATA_level_8E_obj.bin"

DATA_level_B3_obj:
	incbin "LevelData/DATA_level_B3_obj.bin"

DATA_level_C4_obj:
	incbin "LevelData/DATA_level_C4_obj.bin"

DATA_level_CB_obj:
	incbin "LevelData/DATA_level_CB_obj.bin"

DATA_level_D2_obj:
	incbin "LevelData/DATA_level_D2_obj.bin"

DATA_level_2B_spr:
	incbin "LevelData/DATA_level_2B_spr.bin"

DATA_level_62_spr:
	incbin "LevelData/DATA_level_62_spr.bin"

DATA_level_8E_spr:
	incbin "LevelData/DATA_level_8E_spr.bin"

DATA_level_B3_spr:
	incbin "LevelData/DATA_level_B3_spr.bin"

DATA_level_C4_spr:
	incbin "LevelData/DATA_level_C4_spr.bin"
DATA_16F097:							; zero-size alias; Ptrs[$CB] references DATA_16F097-$02
							; (so the actual sprite-stream address is $16F095, inside the
							; preceding incbin -- DATA_level_C4_spr.bin). Editor sees
							; DATA_level_CB_spr.bin (2 bytes = $FFFF terminator).
							; Same vestigial-header pattern as Bank14's DATA_14C6C6.

DATA_level_D2_spr:
	incbin "LevelData/DATA_level_D2_spr.bin"

DATA_level_31_obj:
	incbin "LevelData/DATA_level_31_obj.bin"

DATA_level_68_obj:
	incbin "LevelData/DATA_level_68_obj.bin"

DATA_level_94_obj:
	incbin "LevelData/DATA_level_94_obj.bin"

DATA_level_31_spr:
	incbin "LevelData/DATA_level_31_spr.bin"

DATA_level_68_spr:
	incbin "LevelData/DATA_level_68_spr.bin"

DATA_level_94_spr:
	incbin "LevelData/DATA_level_94_spr.bin"

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($16FFF8, incbin, DATA_16FFF8_YI_U2.bin)	; V1.1: 8-byte payload here
else
	%FREE_BYTES($16FFF8, 8, $FF)				; V1.0: 8-byte $FF tail
endif
%BANK_END(<EndBank>)
endmacro
