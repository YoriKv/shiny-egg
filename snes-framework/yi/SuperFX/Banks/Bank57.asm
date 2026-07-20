; yi/SuperFX/Banks/Bank57.asm -- SuperFX GFX-only bank $57. Single SuperFX bitmap chunk.
; Pure-data; no executable code. GSU-read only (zero 65816 references).
; ⚠ Content correction (2026-07-18): an earlier header here claimed this bank holds
; "H-flipped variants of the $56 background map characters" — that is BYTE-DISPROVEN
; (a flip is a permutation and preserves the byte histogram; $57's histogram matches
; no window of $56 or any other chunky bank). The bank is INDEPENDENT bitmap data of
; unverified purpose (map-render-adjacent by consumer locality). See
; research/graphics-survey/11-vram-loading.md §4.

%SuperFXBankStart(!FXBank57)

DATA_570000:
DATA_gfx_bank57:                         ; SuperFX bitmap, referenced as FXDATA_570000
	incbin "Graphics/SuperFX/DATA_570000.bin"

%SuperFXBankEnd(!FXBank57)
