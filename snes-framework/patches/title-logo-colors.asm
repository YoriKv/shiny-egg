; --- Title Logo Colors: recolor the small "SUPER MARIO" line of the logo ---
;
; The line is 2 rows x 11 cells (cols 4..14) of an 8x8 BG2 tilemap in Mode 0,
; where each cell picks its own 3-bit palette field. Only the field changes the
; color; the glyph (char#) stays put. The logo's sub-palettes define just three
; usable fill colors:
;
;     0 = green   2 = red   3 = yellow
;
; (Field 1 is the big "Yoshi's Island" lettering, black+white; using it here, or
;  any field >3, pulls an unrelated/again-white sub-palette, so stick to 0/2/3.)
;
; Each tilemap word = $2000 | char# | (palette << 10):
;   $2000      = BG priority bit (set on every logo cell — preserved below)
;   char#      = which glyph (low 10 bits)
;   pal << 10  = the 3-bit color field (bits 10-12)
;
; To recolor, edit only the palette digit in each `($0X<<10)` to 0/2/3.
;
; Anchored to !DATA_title_screen_logo_tilemap (= $0F:FC80, DMA'd verbatim to
; VRAM $3E40), so the writes track asm drift. Row r, col c -> word (r*32+c);
; rows 2 & 3 are the small line: row 2 = base+$88, row 3 = base+$C8.

; ---- row 2, cols 4..14  ($0F:FD08) ------------------------------------------
org !DATA_title_screen_logo_tilemap+$88
    dw $2000|$300|($02<<10)  ; col 4   red
    dw $2000|$301|($03<<10)  ; col 5   yellow
    dw $2000|$302|($00<<10)  ; col 6   green
    dw $2000|$303|($00<<10)  ; col 7   green
    dw $2000|$304|($00<<10)  ; col 8   green
    dw $2000|$305|($02<<10)  ; col 9   red
    dw $2000|$306|($03<<10)  ; col 10  yellow
    dw $2000|$307|($03<<10)  ; col 11  yellow
    dw $2000|$308|($00<<10)  ; col 12  green
    dw $2000|$309|($02<<10)  ; col 13  red
    dw $2000|$30a|($03<<10)  ; col 14  yellow

; ---- row 3, cols 4..14  ($0F:FD48) ------------------------------------------
org !DATA_title_screen_logo_tilemap+$C8
    dw $2000|$310|($02<<10)  ; col 4   red
    dw $2000|$311|($03<<10)  ; col 5   yellow
    dw $2000|$312|($00<<10)  ; col 6   green
    dw $2000|$313|($00<<10)  ; col 7   green
    dw $2000|$314|($00<<10)  ; col 8   green
    dw $2000|$315|($02<<10)  ; col 9   red
    dw $2000|$316|($03<<10)  ; col 10  yellow
    dw $2000|$317|($03<<10)  ; col 11  yellow
    dw $2000|$318|($00<<10)  ; col 12  green
    dw $2000|$319|($02<<10)  ; col 13  red
    dw $2000|$31a|($03<<10)  ; col 14  yellow
