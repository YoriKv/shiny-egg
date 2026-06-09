; yi/SuperFX/Banks/Bank54.asm -- SuperFX (GSU-2) GFX-only bank $54. Two SuperFX bitmap chunks.
; Pure-data; no executable code. Bank54 + Bank55 + Bank56 + Bank57 hold the bulk of the
; raw SuperFX bitmap payloads (intro Kamek, title-screen Yoshi, boss bitmaps, etc.).
;
;# See also:
;#   chip/ys_chip0.asm through chip/ys_chip7.asm  -- chip program files that read these bitmaps

%SuperFXBankStart(!FXBank54)

DATA_540000:					; Note: This must be located at the start of a HiROM bank
DATA_gfx_bank54_part1:                   ; SuperFX bitmap, referenced as FXDATA_540000
	incbin "Graphics/SuperFX/DATA_540000.bin"

DATA_548000:
DATA_gfx_bank54_part2:                   ; SuperFX bitmap, referenced as FXDATA_548000
	incbin "Graphics/SuperFX/DATA_548000.bin"

%SuperFXBankEnd(!FXBank54)
