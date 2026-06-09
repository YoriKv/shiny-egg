;#############################################################################################################
;# SRAM_SaveData.asm -- Battery-backed save data ($7C00-$7FFF):
;#   3 save slots x 104 bytes (lives, last level, high scores, pause items, controller, tutorials)
;#   + 3 backup copies + 6-byte checksums + currently-loaded-file index
;#   + 386 bytes unused.
;#############################################################################################################

; Each save slot is 104 ($68) bytes wide:
;   +$00..$01 : # of lives (from last save), word
;   +$02      : last level beaten, byte
;   +$03..$4A : level high scores, 1 byte per map tile (csssssss; c=completed s=score)
;   +$4B..$65 : pause-menu item counts (27 bytes; same format as WRAM $7E0357)
;   +$66      : controller settings (same format as !EXRAM_YI_Global_EggThrowSetting / $700082)
;   +$67      : tutorial-message bitflags (same format as WRAM $7E0372)

;-------------------------------------------------------------------------
; Save file 1 ($7C00-$7C67)
;-------------------------------------------------------------------------
!EXRAM_YI_Global_SaveFile1 #= $007C00|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile1_LivesLo #= $007C00|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile1_LivesHi = !EXRAM_YI_Global_SaveFile1_LivesLo+$01
!EXRAM_YI_Global_SaveFile1_LastLevelBeaten #= $007C02|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile1_LevelHighScores #= $007C03|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile1_PauseMenuItems #= $007C4B|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile1_ControllerSettings #= $007C66|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile1_TutorialFlags #= $007C67|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Save file 2 ($7C68-$7CCF)
;-------------------------------------------------------------------------
!EXRAM_YI_Global_SaveFile2 #= $007C68|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile2_LivesLo #= $007C68|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile2_LivesHi = !EXRAM_YI_Global_SaveFile2_LivesLo+$01
!EXRAM_YI_Global_SaveFile2_LastLevelBeaten #= $007C6A|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile2_LevelHighScores #= $007C6B|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile2_PauseMenuItems #= $007CB3|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile2_ControllerSettings #= $007CCE|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile2_TutorialFlags #= $007CCF|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Save file 3 ($7CD0-$7D37)
;-------------------------------------------------------------------------
!EXRAM_YI_Global_SaveFile3 #= $007CD0|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile3_LivesLo #= $007CD0|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile3_LivesHi = !EXRAM_YI_Global_SaveFile3_LivesLo+$01
!EXRAM_YI_Global_SaveFile3_LastLevelBeaten #= $007CD2|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile3_LevelHighScores #= $007CD3|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile3_PauseMenuItems #= $007D1B|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile3_ControllerSettings #= $007D36|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile3_TutorialFlags #= $007D37|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Backup copies of save files 1-3 ($7D38, $7DA0, $7E08; 104 bytes each)
;-------------------------------------------------------------------------
!EXRAM_YI_Global_SaveFile1Backup #= $007D38|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile2Backup #= $007DA0|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFile3Backup #= $007E08|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Checksums ($7E70 primary, $7E76 backup; 6 bytes each = 3 x word)
;-------------------------------------------------------------------------
; Each entry stores ($7777 - checksum) of its save file (primary or backup), in order
; file 1, file 2, file 3.
!EXRAM_YI_Global_SaveFileChecksums #= $007E70|!SRAMBankBaseAddress
!EXRAM_YI_Global_SaveFileChecksumsBackup #= $007E76|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Currently-loaded save file index ($7E7C): $0000, $0001, or $0002
;-------------------------------------------------------------------------
!EXRAM_YI_Global_CurrentSaveFileIndexLo #= $007E7C|!SRAMBankBaseAddress
!EXRAM_YI_Global_CurrentSaveFileIndexHi = !EXRAM_YI_Global_CurrentSaveFileIndexLo+$01

;-------------------------------------------------------------------------
; Unused battery-backed SRAM ($7E7E-$7FFF, 386 bytes); never cleared.
;-------------------------------------------------------------------------
!EXRAM_YI_Global_UnusedSaveScratch #= $007E7E|!SRAMBankBaseAddress
;---------------------------------------------------------------------------
