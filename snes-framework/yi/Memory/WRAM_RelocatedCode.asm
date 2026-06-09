;#############################################################################################################
;# WRAM_RelocatedCode.asm -- RAM-resident code block + per-routine pointers, copied to $7EC000 at boot ($7EC000-$7EFFFF).
;#############################################################################################################

!RAM_YI_Global_MainRAMCodeBlock = ((YI_MainRAMCodeBlock&$00FFFF)|$7E0000)				; $7EC000 -- outer parens lock | inside substitutions (asar 1.91 precedence)

!RAM_YI_Global_VBlankRt = (YI_VBlankRt-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_DATA_00C1EC = (DATA_00C1EC-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_DATA_00C1F8 = (DATA_00C1F8-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_DATA_00C204 = (DATA_00C204-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_IRQRt = (YI_IRQRt-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_DATA_00CA80 = (DATA_00CA80-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_DATA_00CA8C = (DATA_00CA8C-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_DATA_00CA98 = (DATA_00CA98-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_DATA_00CC58 = (DATA_00CC58-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_DATA_00D2C2 = (DATA_00D2C2-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock

!RAM_YI_Global_RT_00DE47 = (CODE_00DE47-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_RT_00DE67 = (CODE_00DE67-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_RT_00DE91 = (CODE_00DE91-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_RT_00DECF = (CODE_00DECF-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_RT_00E152 = (CODE_00E152-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
!RAM_YI_Global_BeginSuperFXProcessingRt = (YI_BeginSuperFXProcessingRt-YI_MainRAMCodeBlock)+!RAM_YI_Global_MainRAMCodeBlock
