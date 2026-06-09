; YI-local SPC700 macros (restored from v1.2 framework, removed in v1.3.0).
; YI's SPC700 .bin files use the original game's upload-stream format
; (size_word, dest_word, payload, ..., 0_word, jump_word), which these macros emit.

;---------------------------------------------------------------------------

macro SPCDataBlockStart(base)
assert !InBank == !FALSE, "You must put a SPCDataBlockEnd macro before calling SPCDataBlockStart again!"
assert $<base> < $100000, "The SNES only has 64 KB of ARAM! Set the base offset to be between $0200 and $FFFF!"
if $<base> >= !REGISTER_SPC700_IPLROMLoc
	warn "The IPL ROM is located at ARAM address !REGISTER_SPC700_IPLROMLoc. Are you sure that's where you want this data block to be inserted at?"
endif
	dw SPCDataBlockEnd_<base>-SPCDataBlockStart_<base>
	dw $<base>
	base $<base>
	SPCDataBlockStart_<base>:
	!InBank = !TRUE
endmacro

;---------------------------------------------------------------------------

macro SPCDataBlockEnd(base)
assert !InBank == !TRUE, "You must put a SPCDataBlockStart macro before calling SPCDataBlockEnd!"
	SPCDataBlockEnd_<base>:
	base off
	!InBank = !FALSE
endmacro

;---------------------------------------------------------------------------

macro EndSPCUploadAndJumpToEngine(EngineLoc)
assert !InBank == !FALSE, "You can't put a EndSPCUploadAndJumpToEngine in the middle of a data block!"
	dw $0000
	dw <EngineLoc>
endmacro
