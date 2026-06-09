; Bank0B.asm -- SuperFX/GSU-2 code stub for SNES bank $0B. Actual content lives in yi/SuperFX/Banks/Bank0B.asm.
; This file only inserts the pre-compiled GSU binary into the SNES address space at $0B:8000.
macro YIBank0BMacros(StartBank, EndBank)
%BANK_START(<StartBank>)
	%InsertNextPreCompiledCodeBlock($0B8000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")
%BANK_END(<EndBank>)
endmacro
