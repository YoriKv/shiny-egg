; yi/SuperFX/Banks/Bank53.asm -- SuperFX (GSU-2) GFX-only bank $53. Three SuperFX bitmap chunks.
; Pure-data; no executable code. References from the 65816 use FXDATA_530000 / FXDATA_538000 /
; FXDATA_53C000 via the SuperFXPtrs_YI bridge. These feed SuperFX rasterisers (cf. Bank08
; C_*_ZOOM/ROTZOM family) during boss / title / world-map effects.
;
;# See also:
;#   chip/ys_chip0.asm through chip/ys_chip7.asm  -- chip program files that read these bitmaps

%SuperFXBankStart(!FXBank53)

DATA_530000:
DATA_gfx_bank53_part1:                   ; SuperFX bitmap, referenced as FXDATA_530000
	incbin "Graphics/SuperFX/DATA_530000.bin"

DATA_538000:
DATA_gfx_bank53_part2:                   ; SuperFX bitmap, referenced as FXDATA_538000
	incbin "Graphics/SuperFX/DATA_538000.bin"

DATA_53C000:
DATA_gfx_bank53_part3:                   ; SuperFX bitmap, referenced as FXDATA_53C000
	incbin "Graphics/GFX_53C000.bin"

%SuperFXBankEnd(!FXBank53)
