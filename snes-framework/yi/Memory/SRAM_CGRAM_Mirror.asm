;#############################################################################################################
;# SRAM_CGRAM_Mirror.asm -- CGRAM (palette) working copy ($002000-$0021FF).
;#############################################################################################################

!EXRAM_YI_Global_PaletteMirror #= $002000|!SRAMBankBaseAddress
struct YI_Global_PaletteMirror !EXRAM_YI_Global_PaletteMirror
	.LowByte: skip $01
	.HighByte: skip $01
endstruct align $02
