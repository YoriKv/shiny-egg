; yi/SuperFX/Banks/Bank53.asm -- GFX-only bank $53. Three data chunks: two GSU
; chunky bitmaps + one 65816 planar CHR page. No executable code.
; Verified consumers (codegraph xref):
;   - DATA_530000 ($53:0000, 32 KB) + DATA_538000 ($53:8000, 16 KB): CHUNKY GSU
;     rasteriser source bitmaps (boss / title / world-map effects; cf. Bank08
;     C_*_ZOOM/ROTZOM family). Referenced by SuperFX Bank08 code + parameter
;     tables (CODE_08E0FA, DATA_08DA2E..DATA_08DBBA) and by 65816 sites that
;     pass FXDATA_53x000+offset texture pointers -- the offsets are
;     pixel-granular (e.g. +$001C, +$0070), not 32-byte tile-aligned, which
;     rules out planar CHR.
;   - DATA_53C000 ($53:C000, 16 KB): PLANAR CHR, 65816 DMA only -- the
;     story-cutscene / credits IRQ (CODE_irq_story_cutscene_credits, Bank00)
;     streams 64-byte strips from FXDATA_53C000+offset to VRAM $5400. No GSU
;     references.

%SuperFXBankStart(!FXBank53)

DATA_530000:
DATA_gfx_bank53_part1:                   ; chunky GSU rasteriser bitmap, referenced as FXDATA_530000
	incbin "Graphics/SuperFX/DATA_530000.bin"

DATA_538000:
DATA_gfx_bank53_part2:                   ; chunky GSU rasteriser bitmap, referenced as FXDATA_538000
	incbin "Graphics/SuperFX/DATA_538000.bin"

DATA_53C000:
DATA_gfx_bank53_part3:                   ; planar CHR, 65816 DMA source (story cutscene / credits IRQ); referenced as FXDATA_53C000
	incbin "Graphics/GFX_53C000.bin"

%SuperFXBankEnd(!FXBank53)
