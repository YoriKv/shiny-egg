; YI-local SNES-side macros (restored from v1.2 framework).
; v1.4 replaced %InsertNextPreCompiledCodeBlock with %ReadPreCompiledFilePointers
; (different file format & semantics), and changed %SetNextPreCompiledCodePointer
; from an auto-counter to an explicit-index protocol. YI's .bin files use the
; v1.2 linked-list pointer format, so we keep the v1.2 macros locally.
;
; %YI_SetNextPreCompiledCodePointer is prefixed to avoid colliding with the
; v1.4 framework's same-named macro in Global_Macros.asm.

;---------------------------------------------------------------------------

macro YI_SetNextPreCompiledCodePointer(Label, Define, File)
if !FileType != !FileType_InitializeROM
	if getfilestatus("<File>") == $00
		if filesize("<File>") != $00
			if defined("<Define>Pointers") == !FALSE
				!Max<Define>Pointers #= readfile3("<File>", $000000)
				!<Define>Pointers #= $03
				!<Define>BlockIndex #= readfile3("<File>", $000000)
			endif
			if !<Define>Pointers < !Max<Define>Pointers
				<Label> = readfile3("<File>", !<Define>Pointers)
			else
				error "The Pre-compiled data pointer table for <File> is smaller than the number of labels you're trying to set!"
			endif
			!<Define>Pointers #= !<Define>Pointers+$03
		endif
	else
		error "<File> can't be found or is being used by another program."
	endif
endif
endmacro

;---------------------------------------------------------------------------

macro InsertNextPreCompiledCodeBlock(Address, Define, File)
%InsertMacroAtXPosition(<Address>)
if getfilestatus("<File>") == $00
	if filesize("<File>") != $00
		!TEMP1 #= readfile3("<File>", !<Define>BlockIndex+$03)
		!TEMP2 #= readfile3("<File>", !<Define>BlockIndex+$06)
		incbin "<File>":(!TEMP1)-(!TEMP2)
		if !TEMP1 != $00
			!<Define>BlockIndex #= readfile3("<File>", !<Define>BlockIndex+$06)
		endif
	endif
else
	error "<File> can't be found or is being used by another program."
endif
endmacro
