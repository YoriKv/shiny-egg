;#############################################################################################################
;# Bank56.asm -- SNES bank $56 (HiROM-mirrored full 64 KB SuperFX bank, original cart bank $26).
;#
;# Contents at a glance: uncompressed graphics end to end -- no GSU code in this bank.
;#   $560000-$567FFF -- two raw graphics files ($56:0000 24 KB + $56:6000 8 KB). Emitted via
;#                      %InsertNextPreCompiledCodeBlock, but that macro only streams the next
;#                      chunk of SuperFXCode_YI.bin, which is a contiguous dump rather than a
;#                      code-only blob -- see the Bank52.asm header.
;#   $568000+        -- DATA_568000, an uncompressed Graphics/GFX_568000.bin blob (raw 4 KB-ish
;#                      tile data, included as .bin rather than .lz2/.lz16 -- already plain bytes).
;#                      DATA_noncompressed_gfx_ptrs tiles this half as nine files, $56:8000
;#                      through $56:FC00; the last runs to the LZ2 region at $57:3C00.
;#
;# Cross-references:
;#   Bank06.asm:13543                                 -- the raw graphics file directory.
;#   Bank4D.asm header                                -- HiROM/SuperFX bank scheme.
;#   yi/assets/yi/Graphics/GFX_568000.bin            -- the included graphics blob.
;#   yoshisisland-disassembly/disassembly/bank26.asm -- Raidenthequick's view of the same bank.
;#############################################################################################################
macro YIBank56Macros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)
	%InsertNextPreCompiledCodeBlock($560000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")	; first 32 KB: raw graphics

DATA_568000:							; uncompressed graphics tail of the bank ($568000-$56FFFF)
	incbin "Graphics/GFX_568000.bin"

%BANK_END(<EndBank>)
endmacro
