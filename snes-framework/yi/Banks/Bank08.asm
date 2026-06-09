; Bank08.asm -- SuperFX/GSU-2 code stub for SNES bank $08. Actual content lives in yi/SuperFX/Banks/Bank08.asm.
; This file only inserts the pre-compiled GSU binary into the SNES address space at $08:8000.
macro YIBank08Macros(StartBank, EndBank)
%BANK_START(<StartBank>)
	%InsertNextPreCompiledCodeBlock($088000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")
%BANK_END(<EndBank>)
endmacro
