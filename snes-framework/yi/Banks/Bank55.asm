;#############################################################################################################
;# Bank55.asm -- SNES bank $55 (HiROM-mirrored full 64 KB SuperFX bank, original cart bank $25).
;# Full 64 KB pre-compiled GSU blob; no 65816 code or data. See Bank4D.asm header for the scheme.
;#############################################################################################################
macro YIBank55Macros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)
	%InsertNextPreCompiledCodeBlock($550000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")	; full-bank GSU blob
%BANK_END(<EndBank>)
endmacro
