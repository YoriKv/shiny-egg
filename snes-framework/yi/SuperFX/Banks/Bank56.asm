; yi/SuperFX/Banks/Bank56.asm -- SuperFX GFX-only bank $56. Single SuperFX bitmap chunk.
; Pure-data; no executable code. The SNES address $560000 is the base of the
; "background map character" data the SuperFX reads when drawing scaled / rotated
; background tiles.
;
;# See also:
;#   chip/ys_chip0.asm through chip/ys_chip7.asm  -- chip program files that read this
;#                                                   background-map character data

%SuperFXBankStart(!FXBank56)

DATA_560000:						; Note: This must be inserted at the start of a HiROM bank.
DATA_map_character_base:                 ; SuperFX background map character data base ($560000)
	incbin "Graphics/SuperFX/DATA_560000.bin"

%SuperFXBankEnd(!FXBank56)
