; --- World Map Scroll Fix: let the map camera settle on ODD Yoshi X coords ---
;
; The world-map smooth scroll (cursor moves between level dots, gamemode $22)
; is the per-frame stepper at CODE_17BF63. It steps the camera ($6D) by +/-2
; toward a target ($79) computed at CODE_17BF22 as clamp(yoshiX - $7C, 0, $100),
; and stops ONLY on exact equality:
;
;     LDA $6D : CMP $79 : BEQ CODE_17BF7C
;     LDX $7B : LDA $6D : CLC : ADC.w DATA_17BECE,x   ; +2 or -2
;     AND #$FFFE                                       ; <- forces camera EVEN
;     STA $69 : STA $6D : STA $41
;
; The AND #$FFFE keeps the camera even forever, so when a world-map Yoshi X
; coordinate (DATA_worldmap_yoshi_xcoords_by_world, $17:BDAE) is ODD - making
; the target odd, any odd X in $007D..$0173 - the equality never holds: the
; camera scrolls in one direction forever, the 16-bit value wraps, and the
; 512px map tilemap visibly loops every ~4.3 s. The hidden constraint in the
; vanilla tables is that every X coordinate is even; this patch removes it,
; so repositioned Yoshis (path/world-map editing) scroll correctly.
;
; Fix (same 25 bytes in place, no freespace): terminate when camera and target
; fall in the same even pair (<=1 px apart) instead of on exact equality, and
; drop the evening. With all-even coordinates the dynamics are byte-for-byte
; equivalent to vanilla (even +/-2 stepping still stops exactly on target);
; with odd coordinates the scroll stops within 1 px - invisible - instead of
; looping. Direction selection at CODE_17BF22 (CPX $6D / BCS) is already
; correct for arbitrary left/right placement and is untouched. Odd camera
; resting values are already reachable in vanilla via the walk-follow snap
; (which never evens), so no new downstream state is introduced.
;
; Anchored to the injected !CODE_/!DATA_ defines so every reference tracks the
; build's .sym instead of raw addresses. The branch target must be a LABEL
; (asar takes a numeric branch operand as a raw displacement byte, not an
; address), and the name is patch-prefixed because every enabled patch's asm
; concatenates into one macro body at build time.

org !CODE_17BF63
	REP #$30
	LDA $79                     ; scroll target
	EOR $6D                     ; compare with current camera...
	AND #$FFFE                  ; ...ignoring bit 0: same even pair = arrived
	BEQ WMScrollFix_done
	LDX $7B                     ; direction index from CODE_17BF22 (0=+2, 2=-2)
	LDA $6D
	CLC
	ADC.w !DATA_17BECE&$FFFF,x  ; dw $0002,$FFFE (DB=$17 at runtime)
	STA $69
	STA $6D
	STA $41                     ; Layer3 X (BG3HOFS mirror; also fed to the
	                            ; SuperFX map renderer via $6094 each frame)
; Replacement must end exactly at CODE_17BF7C (the JSL fall-through) - the
; pad is a build-time guard: it errors if the code above ever grows past it.
padbyte $EA
pad !CODE_17BF7C
WMScrollFix_done:
