; yi/SuperFX/Banks/Bank52.asm -- GFX-only bank $52. Pure data, no executable code.
; UNCOMPRESSED planar 4bpp CHR (not compressed, not a GSU chunky bitmap): Yoshi
; player-frame CHR + animated-tile source pages, read by 65816 DMA to VRAM.
; Verified consumers (codegraph xref, ~98 sites):
;   - the Bank00 tile-animation handlers (CODE_tile_animation_00/02/07/08/0C) +
;     their source-pointer tables (DATA_default_tile_anim_source_ptrs etc.) DMA
;     from FXDATA_520000+offset (handler $07 swaps the source bank to $56 when
;     bg1Tileset == $0A);
;   - CODE_pause_upload_sprite_gfx / CODE_load_3d_sprite_graphic ($01:B4A3) and
;     assorted sprite mains DMA sprite pages from it;
;   - the GSU reads no pixels here: its one reference (CODE_09835F, the
;     player-Yoshi drawer in SuperFX Bank09) only emits (address,bank) DMA source
;     descriptors that select bank $52 (cart CHR) vs $70:8300 (a GSU-rendered
;     frame) per tile.
; Nintendo's non-compressed gfx directory (DATA_noncompressed_gfx_ptrs, Bank06)
; splits the bank into three files: $52:0000 (32 KB), $52:8000 (16 KB),
; $52:C000 (16 KB).

%SuperFXBankStart(!FXBank52)

DATA_520000:
DATA_gfx_bank52:                         ; planar 4bpp CHR (Yoshi frames + anim pages), 65816 DMA source; referenced as FXDATA_520000
	incbin "Graphics/GFX_520000.bin"

%SuperFXBankEnd(!FXBank52)
