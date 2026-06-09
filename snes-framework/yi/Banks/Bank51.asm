;#############################################################################################################
;# Bank51.asm -- SNES bank $51 (HiROM-mirrored full 64 KB, original cart bank $21).
;#               Mixed bank: per-level object/sprite data plus another chunk of pre-compiled
;#               SuperFX code. Layout differs between V1.0 and V1.1; this is one of the banks
;#               that the V1.1 dump rearranged.
;#
;# Contents at a glance:
;#   V1.1 (!ROM_YI_U2) layout:
;#       $510000  GSU code blob (next %InsertNextPreCompiledCodeBlock)
;#       inline   DATA_10F262, DATA_10F4FA -- level data blobs that V1.1 hoisted up
;#                                            from low banks into the HiROM mirror.
;#       $510000+ DATA_51xxxx -- six standard level-data blobs (object + sprite streams).
;#       $51567B  garbage padding from V1.1 cart.
;#
;#   V1.0 layout:
;#       $510000  DATA_510000 .. $51106A -- six standard level-data blobs.
;#       $5110DB  GSU code blob.
;#       $515348+ ~44 KB freespace tail.
;#
;# Level-data blob naming: each DATA_XXxxxx is referenced from the level pointer table emitted
;# in Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm (see Ptrs: list); pairs of
;# adjacent labels are the object-stream + sprite-stream for one level slot.
;#
;# Cross-references:
;#   yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm -- consumers.
;#   docs/levelloader.md S3 -- level pointer table cart-version differences (V1.0 $17:F7C3 vs V1.1 $0F:E822).
;#############################################################################################################
macro YIBank51Macros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertNextPreCompiledCodeBlock($510000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")

DATA_level_04_obj:							; V1.1 only -- level-data blob relocated into HiROM
	incbin "LevelData/DATA_level_04_obj.bin"

DATA_level_04_spr:							; V1.1 only -- level-data blob relocated into HiROM
	incbin "LevelData/DATA_level_04_spr.bin"

endif

DATA_level_32_obj:							; level data (object/sprite stream; ptr-table entry)
	incbin "LevelData/DATA_level_32_obj.bin"

DATA_level_69_obj:							; level data
	incbin "LevelData/DATA_level_69_obj.bin"

DATA_level_95_obj:							; level data
	incbin "LevelData/DATA_level_95_obj.bin"

DATA_level_32_spr:							; level data
	incbin "LevelData/DATA_level_32_spr.bin"

DATA_level_69_spr:							; level data
	incbin "LevelData/DATA_level_69_spr.bin"

DATA_level_95_spr:							; level data
	incbin "LevelData/DATA_level_95_spr.bin"

if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00
	%InsertGarbageData($51567B, incbin, DATA_51567B_YI_U2.bin)	; V1.1 padding to bank-end alignment
else
	%InsertNextPreCompiledCodeBlock($5110DB, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")	; V1.0: more GSU code after the level data
	%FREE_BYTES($515348, 44216, $FF)			; V1.0: ~44 KB free tail
endif
%BANK_END(<EndBank>)
endmacro
