;#############################################################################################################
;# SuperFXCode_YI.asm -- master include for the SuperFX/GSU-2 program. Asar assembles
;# the whole tree as a single .bin (SuperFXCode_YI.bin) that the 65816 wrappers then
;# %InsertNextPreCompiledCodeBlock at each ROM bank (see yi/Banks/Bank08.asm ... Bank0B.asm).
;#
;# Include order is load-bearing:
;#   - BankDefines.asm     defines !FXBank08 ... !FXBank57 (used by %SuperFXBankStart below)
;#   - RoutinePointers.asm emits the pointer-table header that names every entry point
;#   - Banks/Bank0X.asm    one file per SuperFX bank, each opens with %SuperFXBankStart(!FXBankXX)
;#
;# See also: docs/mchip.md   (engine reference for this program)
;#############################################################################################################

	incsrc "BankDefines.asm"
	incsrc "RoutinePointers.asm"

	incsrc "Banks/Bank08.asm"
	incsrc "Banks/Bank09.asm"
	incsrc "Banks/Bank0A.asm"
	incsrc "Banks/Bank0B.asm"
	incsrc "Banks/Bank4C.asm"
	incsrc "Banks/Bank4D.asm"
	incsrc "Banks/Bank51.asm"
	incsrc "Banks/Bank52.asm"
	incsrc "Banks/Bank53.asm"
	incsrc "Banks/Bank54.asm"
	incsrc "Banks/Bank55.asm"
	incsrc "Banks/Bank56.asm"
	incsrc "Banks/Bank57.asm"
