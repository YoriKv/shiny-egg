; Bank09.asm -- SuperFX/GSU-2 code stub for SNES bank $09. Actual content lives in yi/SuperFX/Banks/Bank09.asm.
; This file only inserts the pre-compiled GSU binary into the SNES address space at $09:8000.
macro YIBank09Macros(StartBank, EndBank)
%BANK_START(<StartBank>)
	%InsertNextPreCompiledCodeBlock($098000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")
%BANK_END(<EndBank>)
endmacro
