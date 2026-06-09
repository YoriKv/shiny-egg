; Bank0A.asm -- SuperFX/GSU-2 code stub for SNES bank $0A. Actual content lives in yi/SuperFX/Banks/Bank0A.asm.
; This file only inserts the pre-compiled GSU binary into the SNES address space at $0A:8000.
macro YIBank0AMacros(StartBank, EndBank)
%BANK_START(<StartBank>)
	%InsertNextPreCompiledCodeBlock($0A8000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")
%BANK_END(<EndBank>)
endmacro
