;#############################################################################################################
;# WRAM_GameMode_Header.asm -- Game-mode dispatcher index + 15 level-header mirror fields ($000118-$000153).
;#############################################################################################################

; $000101-$00010F: NMI/IRQ jump-table (15 bytes, copy of $008140-$00814E); NMI jumps to $7E0108, IRQ to $7E010C.
; $000111-$000117: 7 bytes, never initialized/cleared.

!RAM_YI_Global_CurrentGameMode = $000118
!RAM_YI_Global_GameModeCompleteFlag = $00011B			; $00 running (set by NMI/IRQ), $FF complete (set by end of game loop)
!RAM_YI_Global_NMIAndIRQMode = $00011C				; index into NMI/IRQ dispatchers (Logo/Level/OffsetPerTile/Island/Cutscene/Mode7/Map/Bonus)
!RAM_YI_Global_BG1HOFSMirrorLo = $00011D			; full 16-bit mirror of $210D (BG1 H scroll); written write-twice
!RAM_YI_Global_BG1HOFSMirrorHi = !RAM_YI_Global_BG1HOFSMirrorLo+$01
!RAM_YI_Global_BG1VOFSMirrorLo = $00011F			; full 16-bit mirror of $210E (BG1 V scroll)
!RAM_YI_Global_BG1VOFSMirrorHi = !RAM_YI_Global_BG1VOFSMirrorLo+$01
!RAM_YI_Level_LoadWithStageIntroFlag = $000121			; $02 if stage-intro text shown
!RAM_YI_Global_IRQCounter = $000125				; expected 0..2
!RAM_YI_Global_MainIRQMode = $000126				; $00 default, $02 cutscene, $04 credits, $06 bonus/bandit
!RAM_YI_Global_SuperFX_SCBRMirror = $00012D			; $3038 mirror; GSU init
!RAM_YI_Global_SuperFX_SCMRMirror = $00012E			; $303A mirror; GSU init
!RAM_YI_Debug_FrameAdvanceFlag = $00012F			; debug routine at $0080F8: $00 disable, $01 enable
!RAM_YI_Debug_FrameAdvanceTimer = $000130			; counts down per frame while L/R held on joy2
!RAM_YI_Cutscene_IslandFrameCounterLo = $000131			; Island scenes' frame counter
!RAM_YI_Cutscene_IslandFrameCounterHi = !RAM_YI_Cutscene_IslandFrameCounterLo+$01

!RAM_YI_Level_LevelHeaderBackgroundColorLo = $000134
!RAM_YI_Level_LevelHeaderBackgroundColorHi = !RAM_YI_Level_LevelHeaderBackgroundColorLo+$01
!RAM_YI_Level_LevelHeaderBG1TilesetLo = $000136
!RAM_YI_Level_LevelHeaderBG1TilesetHi = !RAM_YI_Level_LevelHeaderBG1TilesetLo+$01
!RAM_YI_Level_LevelHeaderBG1PaletteLo = $000138
!RAM_YI_Level_LevelHeaderBG1PaletteHi = !RAM_YI_Level_LevelHeaderBG1PaletteLo+$01
!RAM_YI_Level_LevelHeaderBG2TilesetLo = $00013A
!RAM_YI_Level_LevelHeaderBG2TilesetHi = !RAM_YI_Level_LevelHeaderBG2TilesetLo+$01
!RAM_YI_Level_LevelHeaderBG2PaletteLo = $00013C
!RAM_YI_Level_LevelHeaderBG2PaletteHi = !RAM_YI_Level_LevelHeaderBG2PaletteLo+$01
!RAM_YI_Level_LevelHeaderBG3TilesetLo = $00013E
!RAM_YI_Level_LevelHeaderBG3TilesetHi = !RAM_YI_Level_LevelHeaderBG3TilesetLo+$01
!RAM_YI_Level_LevelHeaderBG3PaletteLo = $000140
!RAM_YI_Level_LevelHeaderBG3PaletteHi = !RAM_YI_Level_LevelHeaderBG3PaletteLo+$01
!RAM_YI_Level_LevelHeaderSpriteTilesetLo = $000142
!RAM_YI_Level_LevelHeaderSpriteTilesetHi = !RAM_YI_Level_LevelHeaderSpriteTilesetLo+$01
!RAM_YI_Level_LevelHeaderSpritePaletteLo = $000144
!RAM_YI_Level_LevelHeaderSpritePaletteHi = !RAM_YI_Level_LevelHeaderSpritePaletteLo+$01
!RAM_YI_Level_LevelHeaderLevelModeLo = $000146
!RAM_YI_Level_LevelHeaderLevelModeHi = !RAM_YI_Level_LevelHeaderLevelModeLo+$01
!RAM_YI_Level_LevelHeaderAnimationTilesetLo = $000148
!RAM_YI_Level_LevelHeaderAnimationTilesetHi = !RAM_YI_Level_LevelHeaderAnimationTilesetLo+$01
!RAM_YI_Level_LevelHeaderAnimationPaletteLo = $00014A
!RAM_YI_Level_LevelHeaderAnimationPaletteHi = !RAM_YI_Level_LevelHeaderAnimationPaletteLo+$01
!RAM_YI_Level_LevelHeaderBGScrollSettingLo = $00014C
!RAM_YI_Level_LevelHeaderBGScrollSettingHi = !RAM_YI_Level_LevelHeaderBGScrollSettingLo+$01
!RAM_YI_Level_LevelHeaderMusicSettingLo = $00014E
!RAM_YI_Level_LevelHeaderMusicSettingHi = !RAM_YI_Level_LevelHeaderMusicSettingLo+$01
!RAM_YI_Level_LevelHeaderItemMemorySettingLo = $000150
!RAM_YI_Level_LevelHeaderItemMemorySettingHi = !RAM_YI_Level_LevelHeaderItemMemorySettingLo+$01
!RAM_YI_Level_UnusedLevelHeaderSettingLo = $000152
!RAM_YI_Level_UnusedLevelHeaderSettingHi = !RAM_YI_Level_UnusedLevelHeaderSettingLo+$01
