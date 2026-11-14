;#############################################################################################################
;# Bank52.asm -- SNES bank $52 (HiROM-mirrored full 64 KB SuperFX bank, original cart bank $22).
;#
;# Full 64 KB of UNCOMPRESSED graphics; no 65816 code or data, and despite the emit mechanism
;# below, no GSU code either. %InsertNextPreCompiledCodeBlock just streams the next chunk of
;# SuperFXCode_YI.bin -- that .bin is a straight dump of everything the extractor pulls out in
;# one contiguous run, so "next chunk of the blob" does NOT imply "code". Banks $52-$56 are
;# raw 4bpp tile data: DATA_noncompressed_gfx_ptrs ($06:F91F) tiles $52:0000-$56:FFFF with 21
;# back-to-back raw graphics files, three of which ($52:0000/$52:8000/$52:C000) cover this bank.
;#
;# Cross-references:
;#   Bank06.asm:13543 -- the raw graphics file directory and its byte-exact contents.
;#   Bank4D.asm header -- HiROM/SuperFX bank scheme (and a bank that really is GSU code).
;#############################################################################################################
macro YIBank52Macros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)
	%InsertNextPreCompiledCodeBlock($520000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")	; full bank of raw graphics
%BANK_END(<EndBank>)
endmacro
