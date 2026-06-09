;#############################################################################################################
;# RAM_Map_YI.asm -- split into per-region files in Memory/ for navigability.
;#############################################################################################################

	incsrc "Memory/WRAM_DirectPage.asm"
	incsrc "Memory/WRAM_GameMode_Header.asm"
	incsrc "Memory/WRAM_LevelState.asm"
	incsrc "Memory/WRAM_HardwareRegs.asm"
	incsrc "Memory/WRAM_RuntimeEffects.asm"
	incsrc "Memory/WRAM_LevelTemplateSlots.asm"
	incsrc "Memory/WRAM_RelocatedCode.asm"
	incsrc "Memory/WRAM_Buffers.asm"
