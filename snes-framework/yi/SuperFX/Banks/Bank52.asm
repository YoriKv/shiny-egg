; yi/SuperFX/Banks/Bank52.asm -- SuperFX (GSU-2) GFX-only bank $52. Pure-bitmap, no executable code.
; SuperFX-side compressed graphics asset (LC_LZ16 format per the framework's .lz16 naming).
; The 65816 references DATA_520000 via the SuperFXPtrs_YI bridge (FXDATA_520000) to load
; the bitmap into SuperFX RAM during a level-entry / boss-transition scene.
;
;# See also:
;#   chip/ys_chip0.asm through chip/ys_chip7.asm  -- chip program files that read this bitmap

%SuperFXBankStart(!FXBank52)

DATA_520000:
DATA_gfx_bank52:                         ; SuperFX bitmap, referenced as FXDATA_520000
	incbin "Graphics/GFX_520000.bin"

%SuperFXBankEnd(!FXBank52)
