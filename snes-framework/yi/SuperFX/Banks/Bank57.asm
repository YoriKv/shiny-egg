; yi/SuperFX/Banks/Bank57.asm -- SuperFX GFX-only bank $57. Single SuperFX bitmap chunk.
; Pure-data; no executable code. The address $568000 holds the H-flipped variants
; of the background map characters that begin at $560000, allowing the SuperFX
; rasteriser to render flipped tiles without per-pixel mirroring logic.
;
;# See also:
;#   chip/ys_chip0.asm through chip/ys_chip7.asm  -- chip program files that read these
;#                                                   H-flipped background-map character variants

%SuperFXBankStart(!FXBank57)

DATA_570000:
DATA_gfx_bank57:                         ; SuperFX bitmap, referenced as FXDATA_570000
	incbin "Graphics/SuperFX/DATA_570000.bin"

%SuperFXBankEnd(!FXBank57)
