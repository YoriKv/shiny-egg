;#############################################################################################################
;# Routine_Macros_YI.asm -- split into per-bank + per-routine files for navigability.
;# Asar processes incsrc-d files inline, so this is a pure structural change.
;# Order is preserved from the original mega-file; do not reorder without verifying MD5 stays exact.
;#
;# NOTE -- the bank-file list below jumps from Bank17.asm straight to Bank4C.asm.
;# Banks $18-$3F intentionally have no per-bank file. Those SNES addresses are emitted via the
;# SuperFX HiROM-style mapping in yi/Banks/Bank57.asm: that single macro emits the contiguous
;# $40-$5F SuperFX region (compressed graphics, palette ROM, tilemaps), and the same cart bytes
;# are reachable from the 65816 via LoROM at $18-$3F. So when an external reference (SMW Central
;# memory map, brunovalads wiki) cites an address like `$3F:A000`, the framework source
;# for it is in `Banks/Bank57.asm` under the SuperFX-side label `DATA_5FA000` (both forms resolve
;# to the same PC byte `$1FA000`). See `docs/enginecore.md` SuperFX-bank-mapping for the math
;# and `Banks/Bank57.asm` header for the full byte-by-byte layout.
;#############################################################################################################

	incsrc "Banks/Bank00.asm"
	incsrc "Banks/Bank01.asm"
	incsrc "Banks/Bank02.asm"
	incsrc "Banks/Bank03.asm"
	incsrc "Banks/Bank04.asm"
	incsrc "Banks/Bank05.asm"
	incsrc "Banks/Bank06.asm"
	incsrc "Banks/Bank07.asm"
	incsrc "Banks/Bank08.asm"
	incsrc "Banks/Bank09.asm"
	incsrc "Banks/Bank0A.asm"
	incsrc "Banks/Bank0B.asm"
	incsrc "Banks/Bank0C.asm"
	incsrc "Banks/Bank0D.asm"
	incsrc "Banks/Bank0E.asm"
	incsrc "Banks/Bank0F.asm"
	incsrc "Banks/Bank10.asm"
	incsrc "Banks/Bank11.asm"
	incsrc "Banks/Bank12.asm"
	incsrc "Banks/Bank13.asm"
	incsrc "Banks/Bank14.asm"
	incsrc "Banks/Bank15.asm"
	incsrc "Banks/Bank16.asm"
	incsrc "Banks/Bank17.asm"
	incsrc "Banks/Bank4C.asm"
	incsrc "Banks/Bank4D.asm"
	incsrc "Banks/Bank4E.asm"
	incsrc "Banks/Bank4F.asm"
	incsrc "Banks/Bank50.asm"
	incsrc "Banks/Bank51.asm"
	incsrc "Banks/Bank52.asm"
	incsrc "Banks/Bank53.asm"
	incsrc "Banks/Bank54.asm"
	incsrc "Banks/Bank55.asm"
	incsrc "Banks/Bank56.asm"
	incsrc "Banks/Bank57.asm"

	incsrc "Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm"
	incsrc "Routines/ROUTINE_YI_NorSpr03E_ThinPlatform.asm"
	incsrc "Routines/ROUTINE_YI_NorSpr053_KamekSayingOhMy.asm"
	incsrc "Routines/ROUTINE_YI_NorSpr0AA_BackgroundShyguy.asm"
