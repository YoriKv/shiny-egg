;#############################################################################################################
;# Bank53.asm -- SNES bank $53 (HiROM-mirrored full 64 KB SuperFX bank, original cart bank $23).
;#
;# Full 64 KB of UNCOMPRESSED graphics -- not GSU code, despite the emit mechanism (see Bank52.asm
;# header for why %InsertNextPreCompiledCodeBlock does not imply "code"). Three raw graphics files
;# from DATA_noncompressed_gfx_ptrs ($06:F91F) cover this bank: $53:0000, $53:8000, $53:C000.
;#
;# Cross-references:
;#   Bank06.asm:13543 -- the raw graphics file directory and its byte-exact contents.
;#   Bank4D.asm header -- HiROM/SuperFX bank scheme (and a bank that really is GSU code).
;#############################################################################################################
macro YIBank53Macros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)
	%InsertNextPreCompiledCodeBlock($530000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")	; full bank of raw graphics
%BANK_END(<EndBank>)
endmacro
