;#############################################################################################################
;# Bank4D.asm -- SNES bank $4D (HiROM-mirrored full 64 KB SuperFX bank, original cart bank $1D).
;#
;# Contents at a glance:
;#   Entire 64 KB filled by the next chunk of pre-compiled SuperFX (GSU) code, sourced from
;#   SuperFX/SuperFXCode_YI.bin via %InsertNextPreCompiledCodeBlock. No 65816 code or data
;#   in this bank; nothing here is reached by name from the main CPU.
;#
;# Cross-references:
;#   docs/mchip.md S4 -- the 65816 <-> SuperFX bridge, including the bank-mapping scheme
;#       (banks $40-$5F map the FULL 64 KB of each bank to PC, as opposed to standard
;#       LoROM's 32 KB-per-bank; banks $C0-$DF are HiROM mirrors of the same).
;#   yi/SPC700/SuperFX_Macros_YI.asm  -- %InsertNextPreCompiledCodeBlock definition.
;#   yi/SuperFX/                       -- the GSU source assembled into SuperFXCode_YI.bin.
;#   yoshisisland-disassembly/disassembly/bank1D.asm  -- Raidenthequick's view of the
;#       same SuperFX bank (their bank numbering uses the original cart layout).
;#############################################################################################################
macro YIBank4DMacros(StartBank, EndBank)
%BANK_START(<StartBank>)
%EnableSuperFXHiROMMirroring(<StartBank>)
	%InsertNextPreCompiledCodeBlock($4D0000, YI_SuperFXCode, "SuperFX/SuperFXCode_YI.bin")	; full-bank GSU blob
%BANK_END(<EndBank>)
endmacro
