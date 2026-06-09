;#############################################################################################################
;# Bank56.asm -- SNES bank $56 (HiROM-mirrored full 64 KB SuperFX bank, original cart bank $26).
;#
;# Contents at a glance:
;#   $560000-$567FFF -- pre-compiled SuperFX (GSU) code (next chunk of SuperFXCode_YI.bin).
;#   $568000+        -- DATA_568000, an uncompressed Graphics/GFX_568000.bin blob (raw 4 KB-ish
;#                      tile data, included as .bin rather than .lz2/.lz16 -- already plain bytes).
;#
;# Cross-references:
;#   Bank4D.asm header                                -- HiROM/SuperFX bank scheme.
;#   yi/assets/yi/Graphics/GFX_568000.bin            -- the included graphics blob.
;#   yoshisisland-disassembly/disassembly/bank26.asm -- Raidenthequick's view of the same bank.
;#############################################################################################################
macro YIBank56Macros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)
	%InsertNextPreCompiledCodeBlock($560000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")	; first 32 KB: GSU code

DATA_568000:							; uncompressed graphics tail of the bank ($568000-$56FFFF)
	incbin "Graphics/GFX_568000.bin"

%BANK_END(<EndBank>)
endmacro
