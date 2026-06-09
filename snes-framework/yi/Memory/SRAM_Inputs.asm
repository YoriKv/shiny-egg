;#############################################################################################################
;# SRAM_Inputs.asm -- Controller/input mirrors + sound-effect mirror ($000070-$000082).
;#
;# Cartridge-RAM copies of the joypad bytes (used during gamemode $0F), plus the SuperFX/CPU
;# handshake bytes for the music-engine ($2141 mirror) and the SuperFX-returned SFX queue ID.
;# Controller setting at $82 selects between "patient" ($00) and "hasty" ($02) auto-input modes.
;#############################################################################################################

;-- Controller data (gamemode $0F):
;     Joy1 byte 1: AXLR----  (A, X, L, R buttons)
;     Joy1 byte 2: byetUDLR  (B, Y, select, start, up, down, left, right)
;     Press = first-frame edge of each byte.
!EXRAM_YI_Global_Joy1_Lo #= $000070|!SRAMBankBaseAddress
!EXRAM_YI_Global_Joy1_Hi #= $000071|!SRAMBankBaseAddress
!EXRAM_YI_Global_Joy1_PressLo #= $000072|!SRAMBankBaseAddress
!EXRAM_YI_Global_Joy1_PressHi #= $000073|!SRAMBankBaseAddress

;-- SPC/SFX mirrors used by GSU player-control routine + sound queue:
!EXRAM_YI_Global_SPC2141MirrorLo #= $000076|!SRAMBankBaseAddress
!EXRAM_YI_Global_SPC2141MirrorHi = !EXRAM_YI_Global_SPC2141MirrorLo+$01
!EXRAM_YI_Global_SuperFXSoundIDLo #= $00007A|!SRAMBankBaseAddress
!EXRAM_YI_Global_SuperFXSoundIDHi = !EXRAM_YI_Global_SuperFXSoundIDLo+$01

!EXRAM_YI_Global_EggThrowSetting #= $000082|!SRAMBankBaseAddress
