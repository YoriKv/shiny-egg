;#############################################################################################################
;# Bank55.asm -- SNES bank $55 (HiROM-mirrored full 64 KB SuperFX bank, original cart bank $25).
;#
;# Full 64 KB of UNCOMPRESSED graphics -- not GSU code, despite the emit mechanism (see Bank52.asm
;# header for why %InsertNextPreCompiledCodeBlock does not imply "code"). Two 32 KB raw graphics
;# files from DATA_noncompressed_gfx_ptrs ($06:F91F) cover this bank: $55:0000 and $55:8000.
;#
;# Cross-references:
;#   Bank06.asm:13543 -- the raw graphics file directory and its byte-exact contents.
;#   Bank4D.asm header -- HiROM/SuperFX bank scheme (and a bank that really is GSU code).
;#############################################################################################################
macro YIBank55Macros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)
	%InsertNextPreCompiledCodeBlock($550000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")	; full bank of raw graphics
%BANK_END(<EndBank>)
endmacro
