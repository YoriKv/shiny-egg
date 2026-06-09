; YI-local SuperFX macros (restored from v1.2 framework, removed/changed in v1.3.0).
; YI's SuperFX .bin uses the v1.2 pointer-table format:
;   <pointer table end offset, dl ...labels...>
;   <bank entries: dl base, dl start, dl end, bytes...>
; The %YI_SuperFXRoutinePointer name is prefixed to avoid colliding with the
; v1.4 framework's 3-arg %SuperFXRoutinePointer in Global/HardwareRegisters/SuperFX_(SuperFX).asm.

;---------------------------------------------------------------------------

macro SuperFXBankStart(Base)
assert !InBank == !FALSE, "You must put a SuperFXBankEnd macro before calling SuperFXBankStart again!"
assert !SuperFXPointers != $00, "You must generate at least one pointer with YI_SuperFXRoutinePointer() before beginning a SuperFX code bank!"
assert !EndOfSuperFXPointers == !TRUE, "You need to end the SuperFX routine pointer table with EndSuperFXRoutinePointers() before beginning any SuperFX banks!"
	dl $<Base>
	dl FXCODE_<Base>_Start
	dl FXCODE_<Base>_End
	FXCODE_<Base>_Start:
	base $<Base>
	!InBank = !TRUE
endmacro

;---------------------------------------------------------------------------

macro SuperFXBankEnd(Base)
assert !InBank == !TRUE, "You must put a SuperFXBankStart macro before calling SuperFXBankEnd!"
	base off
	FXCODE_<Base>_End:
	!InBank = !FALSE
endmacro

;---------------------------------------------------------------------------

macro YI_SuperFXRoutinePointer(Label)
if !SuperFXPointers == $00
	dl SuperFXPointerTableEnd
	!EndOfSuperFXPointers = !FALSE
SuperFXPointerTableStart:
endif
	dl <Label>
!SuperFXPointers #= !SuperFXPointers+$01
endmacro

;---------------------------------------------------------------------------

macro EndSuperFXRoutinePointers()
assert !SuperFXPointers != $00, "You must generate at least one pointer with YI_SuperFXRoutinePointer() before you can end the pointer table!"
assert !EndOfSuperFXPointers != !TRUE, "You already ended the SuperFX routine pointer table!"

!EndOfSuperFXPointers = !TRUE
SuperFXPointerTableEnd:
endmacro
