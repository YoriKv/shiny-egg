;#############################################################################################################
;# WRAM_DirectPage.asm -- Direct-page scratch + layer cameras + music + sound queue ($000030-$0000FF).
;#############################################################################################################

; $000000-$00002F: 48 bytes of scratch RAM, used like "registers" for various operations.

!RAM_YI_Global_FrameCounterLo = $000030
!RAM_YI_Global_FrameCounterHi = !RAM_YI_Global_FrameCounterLo+$01

!RAM_YI_Level_LevelDataPtrLo = $000032
!RAM_YI_Level_LevelDataPtrHi = !RAM_YI_Level_LevelDataPtrLo+$01
!RAM_YI_Level_LevelDataPtrBank = !RAM_YI_Level_LevelDataPtrLo+$02

; Controller mirrors on direct page (mirrors of $7E093C/D/E/F).
!RAM_YI_Global_Controller1Data1MirrorDP = $000035
!RAM_YI_Global_Controller1Data2MirrorDP = $000036
!RAM_YI_Global_Controller1Data1PressMirrorDP = $000037
!RAM_YI_Global_Controller1Data2PressMirrorDP = $000038

!RAM_YI_Global_Layer1XPosLo #= $000039|!SRAMBankBaseAddress
!RAM_YI_Global_Layer1XPosHi = !RAM_YI_Global_Layer1XPosLo+$01
!RAM_YI_Global_Layer1YPosLo #= $00003B|!SRAMBankBaseAddress
!RAM_YI_Global_Layer1YPosHi = !RAM_YI_Global_Layer1YPosLo+$01
!RAM_YI_Global_Layer2XPosLo #= $00003D|!SRAMBankBaseAddress
!RAM_YI_Global_Layer2XPosHi = !RAM_YI_Global_Layer2XPosLo+$01
!RAM_YI_Global_Layer2YPosLo #= $00003F|!SRAMBankBaseAddress
!RAM_YI_Global_Layer2YPosHi = !RAM_YI_Global_Layer2YPosLo+$01
!RAM_YI_Global_Layer3XPosLo #= $000041|!SRAMBankBaseAddress
!RAM_YI_Global_Layer3XPosHi = !RAM_YI_Global_Layer3XPosLo+$01
!RAM_YI_Global_Layer3YPosLo #= $000043|!SRAMBankBaseAddress
!RAM_YI_Global_Layer3YPosHi = !RAM_YI_Global_Layer3YPosLo+$01
!RAM_YI_Global_Layer4XPosLo #= $000045|!SRAMBankBaseAddress
!RAM_YI_Global_Layer4XPosHi = !RAM_YI_Global_Layer4XPosLo+$01
!RAM_YI_Global_Layer4YPosLo #= $000047|!SRAMBankBaseAddress
!RAM_YI_Global_Layer4YPosHi = !RAM_YI_Global_Layer4YPosLo+$01

!RAM_YI_Global_PlayMusicLo = $00004D
!RAM_YI_Global_PlayMusicHi = !RAM_YI_Global_PlayMusicLo+$01
!RAM_YI_Global_PreviousMusicLo = $00004F
!RAM_YI_Global_PreviousMusicHi = !RAM_YI_Global_PreviousMusicLo+$01

!RAM_YI_Global_PlaySoundHighPriorityLo = $000053
!RAM_YI_Global_PlaySoundHighPriorityHi = !RAM_YI_Global_PlaySoundHighPriorityLo+$01
!RAM_YI_Global_PreviousHighPrioritySoundLo = $000055
!RAM_YI_Global_PreviousHighPrioritySoundHi = !RAM_YI_Global_PreviousHighPrioritySoundLo+$01
!RAM_YI_Global_SoundQueueSizeLo = $000057
!RAM_YI_Global_SoundQueueSizeHi = !RAM_YI_Global_SoundQueueSizeLo+$01
!RAM_YI_Global_SoundQueue = $000059
; $000059-$000068: 16-byte sound effect queue (decremented each frame; capacity 7).

; --- World-map scroll state ($000069-$00006E shared with in-level scratch) ---
!RAM_YI_Map_Layer1ScrollLo = $000069
!RAM_YI_Map_Layer1ScrollHi = !RAM_YI_Map_Layer1ScrollLo+$01
!RAM_YI_Global_Layer1YoshiJumpStateMirrorLo = $00006B			; mirror of $7000C0 (CARTRAM jump state)
!RAM_YI_Global_Layer1YoshiJumpStateMirrorHi = !RAM_YI_Global_Layer1YoshiJumpStateMirrorLo+$01
!RAM_YI_Map_Layer2ScrollLo = $00006D
!RAM_YI_Map_Layer2ScrollHi = !RAM_YI_Map_Layer2ScrollLo+$01

; --- World-map Yoshi-sprite coords + scroll dest (overlap level-mode scratch) ---
!RAM_YI_Map_CurrentStageYoshiYPosLo = $000072
!RAM_YI_Map_CurrentStageYoshiYPosHi = !RAM_YI_Map_CurrentStageYoshiYPosLo+$01
!RAM_YI_Level_CameraMovingDirXLo = $000073				; $0000 = right, $0002 = left
!RAM_YI_Level_CameraMovingDirXHi = !RAM_YI_Level_CameraMovingDirXLo+$01
!RAM_YI_Level_CameraMovingDirYLo = $000075				; $0000 = down, $0002 = up
!RAM_YI_Level_CameraMovingDirYHi = !RAM_YI_Level_CameraMovingDirYLo+$01
!RAM_YI_Map_CurrentStageYoshiXPosLo = $000076
!RAM_YI_Map_CurrentStageYoshiXPosHi = !RAM_YI_Map_CurrentStageYoshiXPosLo+$01
!RAM_YI_Level_NewColumnSpawnedFlagLo = $000077
!RAM_YI_Level_NewColumnSpawnedFlagHi = !RAM_YI_Level_NewColumnSpawnedFlagLo+$01
!RAM_YI_Map_XScrollDestLo = $000079					; aliases !RAM_YI_Level_NewRowSpawnedFlag in level mode
!RAM_YI_Map_XScrollDestHi = !RAM_YI_Map_XScrollDestLo+$01
!RAM_YI_Level_NewRowSpawnedFlagLo = $000079
!RAM_YI_Level_NewRowSpawnedFlagHi = !RAM_YI_Level_NewRowSpawnedFlagLo+$01

; --- Layer-1 tilemap streaming scratch (most-recently spawned column/row) ---
!RAM_YI_Level_LastSpawnedColumnVRAMAddrLo = $00007B
!RAM_YI_Level_LastSpawnedColumnVRAMAddrHi = !RAM_YI_Level_LastSpawnedColumnVRAMAddrLo+$01
!RAM_YI_Level_LastSpawnedRowVRAMAddrLo = $00007D
!RAM_YI_Level_LastSpawnedRowVRAMAddrHi = !RAM_YI_Level_LastSpawnedRowVRAMAddrLo+$01
!RAM_YI_Level_LastSpawnedColumnRightHalfLo = $00007F			; $7B + 1
!RAM_YI_Level_LastSpawnedColumnRightHalfHi = !RAM_YI_Level_LastSpawnedColumnRightHalfLo+$01
!RAM_YI_Level_LastSpawnedRowEvenOddCounterpartLo = $000081		; $7D with $0400 flipped
!RAM_YI_Level_LastSpawnedRowEvenOddCounterpartHi = !RAM_YI_Level_LastSpawnedRowEvenOddCounterpartLo+$01
!RAM_YI_Level_NewRowNegCameraXColumnLo = $000083
!RAM_YI_Level_NewRowNegCameraXColumnHi = !RAM_YI_Level_NewRowNegCameraXColumnLo+$01
!RAM_YI_Level_LastSpawnedRowBottomHalfLo = $000085			; $7D + $20
!RAM_YI_Level_LastSpawnedRowBottomHalfHi = !RAM_YI_Level_LastSpawnedRowBottomHalfLo+$01
!RAM_YI_Level_NewRowCameraXColumnPlus1Lo = $000087
!RAM_YI_Level_NewRowCameraXColumnPlus1Hi = !RAM_YI_Level_NewRowCameraXColumnPlus1Lo+$01

; --- Game-over screen state ($000089-$0000CB; overlaps level-mode scratch) ---
!RAM_YI_Global_GameOverStateLo = $000089				; $00 nothing, $02 fading in, $04 active, $06 option chosen, $08 load title
!RAM_YI_Global_GameOverStateHi = !RAM_YI_Global_GameOverStateLo+$01
!RAM_YI_Level_LastSpawnedRowEvenOddCounterpartBottomLo = $000089	; $81 + $20 (aliases GameOverState)
!RAM_YI_Level_LastSpawnedRowEvenOddCounterpartBottomHi = !RAM_YI_Level_LastSpawnedRowEvenOddCounterpartBottomLo+$01
!RAM_YI_Level_LastSpawnedRowYCoordLo = $00008B
!RAM_YI_Level_LastSpawnedRowYCoordHi = !RAM_YI_Level_LastSpawnedRowYCoordLo+$01

!RAM_YI_GameOver_LetterRotYValues = $000091				; 8 bytes, one per letter (R, E ... A, G)
!RAM_YI_GameOver_LetterRotXValues = $000099				; 8 bytes, one per letter
!RAM_YI_GameOver_LetterXCoords = $0000A1				; 8 words, one per letter (G, A ... E, R)
!RAM_YI_GameOver_LetterYCoords = $0000B1				; 8 words, one per letter
!RAM_YI_GameOver_LetterScaleLo = $0000C1
!RAM_YI_GameOver_LetterScaleHi = !RAM_YI_GameOver_LetterScaleLo+$01
!RAM_YI_GameOver_CurrentOptionLo = $0000C3				; $00 yes, $02 no
!RAM_YI_GameOver_CurrentOptionHi = !RAM_YI_GameOver_CurrentOptionLo+$01
!RAM_YI_GameOver_LetterRotVelLo = $0000C5
!RAM_YI_GameOver_LetterRotVelHi = !RAM_YI_GameOver_LetterRotVelLo+$01
!RAM_YI_GameOver_RotRestartTimerLo = $0000C8
!RAM_YI_GameOver_RotRestartTimerHi = !RAM_YI_GameOver_RotRestartTimerLo+$01
!RAM_YI_GameOver_OptionsAppearTimerLo = $0000CA
!RAM_YI_GameOver_OptionsAppearTimerHi = !RAM_YI_GameOver_OptionsAppearTimerLo+$01

; $0000CC-$0000FF: 52 bytes cleared each loading screen (unused otherwise).
; $000100: never initialized/cleared (1 byte; debug?).
