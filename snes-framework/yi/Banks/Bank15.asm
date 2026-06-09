;#############################################################################################################
;# Bank15.asm -- LoROM bank $15. Pure level-data bank (~115 per-level object/sprite stream
;#               blobs included as raw .bin files). Same semantics as Bank14: each DATA_15XXXX
;#               label is consumed by the Ptrs: table from
;#               Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm.
;#
;# One unusual feature: DATA_15FCEA is a 1-byte free-byte slot (%FREE_BYTES(...,1,$FF)) used
;# as a sentinel value for two pointer-table entries that intentionally point at the same
;# $FF padding byte; do NOT remove or rearrange it.
;#
;# Cross-references:
;#   yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm
;#   yoshisisland-disassembly/disassembly/bank15.asm
;#   docs/levelloader.md S3                                    -- pointer-table semantics.
;#############################################################################################################
macro YIBank15Macros(StartBank, EndBank)
%BANK_START(<StartBank>)

DATA_level_07_obj:
	incbin "LevelData/DATA_level_07_obj.bin"

DATA_level_40_obj:
	incbin "LevelData/DATA_level_40_obj.bin"

DATA_level_70_obj:
	incbin "LevelData/DATA_level_70_obj.bin"

DATA_level_9B_obj:
	incbin "LevelData/DATA_level_9B_obj.bin"

DATA_level_07_spr:
	incbin "LevelData/DATA_level_07_spr.bin"

DATA_level_40_spr:
	incbin "LevelData/DATA_level_40_spr.bin"

DATA_level_70_spr:
	incbin "LevelData/DATA_level_70_spr.bin"

DATA_level_9B_spr:
	incbin "LevelData/DATA_level_9B_spr.bin"

DATA_level_0B_obj:
	incbin "LevelData/DATA_level_0B_obj.bin"

DATA_level_43_obj:
	incbin "LevelData/DATA_level_43_obj.bin"

DATA_level_73_obj:
	incbin "LevelData/DATA_level_73_obj.bin"

DATA_level_0B_spr:
	incbin "LevelData/DATA_level_0B_spr.bin"

DATA_level_43_spr:
	incbin "LevelData/DATA_level_43_spr.bin"

DATA_level_73_spr:
	incbin "LevelData/DATA_level_73_spr.bin"

DATA_level_0C_obj:
	incbin "LevelData/DATA_level_0C_obj.bin"

DATA_level_44_obj:
	incbin "LevelData/DATA_level_44_obj.bin"

DATA_level_74_obj:
	incbin "LevelData/DATA_level_74_obj.bin"

DATA_level_9D_obj:
	incbin "LevelData/DATA_level_9D_obj.bin"

DATA_level_BB_obj:
	incbin "LevelData/DATA_level_BB_obj.bin"

DATA_level_C7_obj:
	incbin "LevelData/DATA_level_C7_obj.bin"

DATA_level_CE_obj:
	incbin "LevelData/DATA_level_CE_obj.bin"

DATA_level_0C_spr:
	incbin "LevelData/DATA_level_0C_spr.bin"

DATA_level_44_spr:
	incbin "LevelData/DATA_level_44_spr.bin"

DATA_level_74_spr:
	incbin "LevelData/DATA_level_74_spr.bin"

DATA_level_9D_spr:
	incbin "LevelData/DATA_level_9D_spr.bin"

DATA_level_BB_spr:
	incbin "LevelData/DATA_level_BB_spr.bin"

DATA_level_C7_spr:
	incbin "LevelData/DATA_level_C7_spr.bin"

DATA_level_CE_spr:
	incbin "LevelData/DATA_level_CE_spr.bin"

DATA_level_0D_obj:
	incbin "LevelData/DATA_level_0D_obj.bin"

DATA_level_45_obj:
	incbin "LevelData/DATA_level_45_obj.bin"

DATA_level_75_obj:
	incbin "LevelData/DATA_level_75_obj.bin"

DATA_level_9E_obj:
	incbin "LevelData/DATA_level_9E_obj.bin"

DATA_level_BC_obj:
	incbin "LevelData/DATA_level_BC_obj.bin"

DATA_level_0D_spr:
	incbin "LevelData/DATA_level_0D_spr.bin"

DATA_level_45_spr:
	incbin "LevelData/DATA_level_45_spr.bin"

DATA_level_75_spr:
	incbin "LevelData/DATA_level_75_spr.bin"

DATA_level_9E_spr:
	incbin "LevelData/DATA_level_9E_spr.bin"

DATA_level_BC_spr:
	incbin "LevelData/DATA_level_BC_spr.bin"

DATA_level_0E_obj:
	incbin "LevelData/DATA_level_0E_obj.bin"

DATA_level_46_obj:
	incbin "LevelData/DATA_level_46_obj.bin"

DATA_level_76_obj:
	incbin "LevelData/DATA_level_76_obj.bin"

DATA_level_9F_obj:
	incbin "LevelData/DATA_level_9F_obj.bin"

DATA_level_BD_obj:
	incbin "LevelData/DATA_level_BD_obj.bin"

DATA_level_0E_spr:
	incbin "LevelData/DATA_level_0E_spr.bin"

DATA_level_46_spr:
	incbin "LevelData/DATA_level_46_spr.bin"

DATA_level_76_spr:
	incbin "LevelData/DATA_level_76_spr.bin"

DATA_level_9F_spr:
	incbin "LevelData/DATA_level_9F_spr.bin"

DATA_level_BD_spr:
	incbin "LevelData/DATA_level_BD_spr.bin"

DATA_level_16_obj:
	incbin "LevelData/DATA_level_16_obj.bin"

DATA_level_4E_obj:
	incbin "LevelData/DATA_level_4E_obj.bin"

DATA_level_7C_obj:
	incbin "LevelData/DATA_level_7C_obj.bin"

DATA_level_A4_obj:
	incbin "LevelData/DATA_level_A4_obj.bin"

DATA_level_16_spr:
	incbin "LevelData/DATA_level_16_spr.bin"

DATA_level_4E_spr:
	incbin "LevelData/DATA_level_4E_spr.bin"

DATA_level_7C_spr:
	incbin "LevelData/DATA_level_7C_spr.bin"

DATA_level_A4_spr:
	incbin "LevelData/DATA_level_A4_spr.bin"

DATA_level_1A_obj:
	incbin "LevelData/DATA_level_1A_obj.bin"

DATA_level_1A_spr:
	incbin "LevelData/DATA_level_1A_spr.bin"

DATA_level_1D_obj:
	incbin "LevelData/DATA_level_1D_obj.bin"

DATA_level_54_obj:
	incbin "LevelData/DATA_level_54_obj.bin"

DATA_level_1D_spr:
	incbin "LevelData/DATA_level_1D_spr.bin"

DATA_level_54_spr:
	incbin "LevelData/DATA_level_54_spr.bin"

DATA_level_24_obj:
	incbin "LevelData/DATA_level_24_obj.bin"

DATA_level_5B_obj:
	incbin "LevelData/DATA_level_5B_obj.bin"

DATA_level_87_obj:
	incbin "LevelData/DATA_level_87_obj.bin"

DATA_level_AD_obj:
	incbin "LevelData/DATA_level_AD_obj.bin"

DATA_level_C2_obj:
	incbin "LevelData/DATA_level_C2_obj.bin"

DATA_level_24_spr:
	incbin "LevelData/DATA_level_24_spr.bin"

DATA_level_5B_spr:
	incbin "LevelData/DATA_level_5B_spr.bin"

DATA_level_87_spr:
	incbin "LevelData/DATA_level_87_spr.bin"

DATA_level_AD_spr:
	incbin "LevelData/DATA_level_AD_spr.bin"

DATA_level_C2_spr:
	incbin "LevelData/DATA_level_C2_spr.bin"

DATA_level_26_obj:
	incbin "LevelData/DATA_level_26_obj.bin"

DATA_level_5D_obj:
	incbin "LevelData/DATA_level_5D_obj.bin"

DATA_level_89_obj:
	incbin "LevelData/DATA_level_89_obj.bin"

DATA_level_AF_obj:
	incbin "LevelData/DATA_level_AF_obj.bin"

DATA_level_C3_obj:
	incbin "LevelData/DATA_level_C3_obj.bin"

DATA_level_CA_obj:
	incbin "LevelData/DATA_level_CA_obj.bin"

DATA_level_D1_obj:
	incbin "LevelData/DATA_level_D1_obj.bin"

DATA_level_26_spr:
	incbin "LevelData/DATA_level_26_spr.bin"

DATA_level_5D_spr:
	incbin "LevelData/DATA_level_5D_spr.bin"

DATA_level_89_spr:
	incbin "LevelData/DATA_level_89_spr.bin"

DATA_level_AF_spr:
	incbin "LevelData/DATA_level_AF_spr.bin"

DATA_level_C3_spr:
	incbin "LevelData/DATA_level_C3_spr.bin"

DATA_level_CA_spr:
	incbin "LevelData/DATA_level_CA_spr.bin"

DATA_level_D1_spr:
	incbin "LevelData/DATA_level_D1_spr.bin"

DATA_level_2E_obj:
	incbin "LevelData/DATA_level_2E_obj.bin"

DATA_level_65_obj:
	incbin "LevelData/DATA_level_65_obj.bin"

DATA_level_91_obj:
	incbin "LevelData/DATA_level_91_obj.bin"

DATA_level_2E_spr:
	incbin "LevelData/DATA_level_2E_spr.bin"

DATA_level_65_spr:
	incbin "LevelData/DATA_level_65_spr.bin"

DATA_level_91_spr:
	incbin "LevelData/DATA_level_91_spr.bin"

DATA_level_34_obj:
	incbin "LevelData/DATA_level_34_obj.bin"

DATA_level_6B_obj:
	incbin "LevelData/DATA_level_6B_obj.bin"

DATA_level_97_obj:
	incbin "LevelData/DATA_level_97_obj.bin"

DATA_level_B8_obj:
	incbin "LevelData/DATA_level_B8_obj.bin"

DATA_level_C6_obj:
	incbin "LevelData/DATA_level_C6_obj.bin"

DATA_level_D8_obj:
	incbin "LevelData/DATA_level_D8_obj.bin"

DATA_level_D9_obj:
	incbin "LevelData/DATA_level_D9_obj.bin"

DATA_level_CD_obj:
	incbin "LevelData/DATA_level_CD_obj.bin"

DATA_level_D3_obj:
	incbin "LevelData/DATA_level_D3_obj.bin"

DATA_level_D6_obj:
	incbin "LevelData/DATA_level_D6_obj.bin"

DATA_level_DC_obj:
	incbin "LevelData/DATA_level_DC_obj.bin"

DATA_level_DD_obj:
	incbin "LevelData/DATA_level_DD_obj.bin"

DATA_15FCEA:							; sentinel: 1-byte $FF used as a "null" pointer target
	%FREE_BYTES($15FCEA, 1, $FF)

DATA_15FCEB:
	incbin "LevelData/DATA_15FCEB.bin"

DATA_level_34_spr:
	incbin "LevelData/DATA_level_34_spr.bin"

DATA_level_6B_spr:
	incbin "LevelData/DATA_level_6B_spr.bin"

DATA_level_97_spr:
	incbin "LevelData/DATA_level_97_spr.bin"

DATA_level_B8_spr:
	incbin "LevelData/DATA_level_B8_spr.bin"

DATA_level_C6_spr:
	incbin "LevelData/DATA_level_C6_spr.bin"

DATA_level_D8_spr:
	incbin "LevelData/DATA_level_D8_spr.bin"

DATA_level_D9_spr:
	incbin "LevelData/DATA_level_D9_spr.bin"

DATA_level_CD_spr:
	incbin "LevelData/DATA_level_CD_spr.bin"

DATA_level_D3_spr:
	incbin "LevelData/DATA_level_D3_spr.bin"

DATA_level_D6_spr:
	incbin "LevelData/DATA_level_D6_spr.bin"

DATA_level_DC_spr:
	incbin "LevelData/DATA_level_DC_spr.bin"

DATA_level_DD_spr:
	incbin "LevelData/DATA_level_DD_spr.bin"

DATA_15FFD5:
if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($15FFD5, incbin, DATA_15FFD5_YI_U2.bin)	; V1.1: extra payload here
else
	%FREE_BYTES($15FFD5, 43, $FF)				; V1.0: 43-byte $FF tail
endif

%BANK_END(<EndBank>)
endmacro
