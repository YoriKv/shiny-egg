; yi/SuperFX/Banks/Bank55.asm -- SuperFX (GSU-2) GFX-only bank $55. Two SuperFX bitmap chunks.
; Pure-data; no executable code.
;
;# See also:
;#   chip/ys_chip0.asm through chip/ys_chip7.asm  -- chip program files that read these bitmaps

%SuperFXBankStart(!FXBank55)

DATA_550000:
DATA_gfx_bank55_part1:                   ; SuperFX bitmap, referenced as FXDATA_550000
	incbin "Graphics/SuperFX/DATA_550000.bin"

DATA_558000:
DATA_gfx_bank55_part2:                   ; SuperFX bitmap, referenced as FXDATA_558000
	incbin "Graphics/SuperFX/DATA_558000.bin"

%SuperFXBankEnd(!FXBank55)
