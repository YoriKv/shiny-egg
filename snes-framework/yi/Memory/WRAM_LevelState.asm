;#############################################################################################################
;# WRAM_LevelState.asm -- Per-level state: world, save file, lives, coins, stars, item memory page, Yoshi delay buffers ($000200-$000811).
;#############################################################################################################

; $00015F-$0001FF: 161-byte reserved stack region (never zeroed, even at reset).
!RAM_YI_Global_ScreenBrightness = $000200			; s000bbbb: s = black if set, b = brightness ($2100-like)
!RAM_YI_Global_FadeInOutMode = $000201				; $00 fade in, $01 fade out
!RAM_YI_Global_MusicHeaderMirrorLo = $000203			; mirror of music header + 1; index for SPC block uploads
!RAM_YI_Global_MusicHeaderMirrorHi = !RAM_YI_Global_MusicHeaderMirrorLo+$01
!RAM_YI_Global_LoadedSPCBlocks = $000207			; 4 bytes: SPC block indices currently in ARAM

!RAM_YI_Level_CurrentBonusGame = $000212

!RAM_YI_Level_FinalWorldUnlockedFlagLo = $000216
!RAM_YI_Level_FinalWorldUnlockedFlagHi = !RAM_YI_Level_FinalWorldUnlockedFlagLo+$01
!RAM_YI_Level_CurrentWorldLo = $000218
!RAM_YI_Level_CurrentWorldHi = !RAM_YI_Level_CurrentWorldLo+$01
!RAM_YI_Level_CurrentLevelFromMapLo = $00021A
!RAM_YI_Level_CurrentLevelFromMapHi = !RAM_YI_Level_CurrentLevelFromMapLo+$01

!RAM_YI_Map_LevelClearFlags = $000222

!RAM_YI_Map_LevelHighScores = $0002B8

!RAM_YI_Global_CurrentSaveFile = $00030E
!RAM_YI_Map_MapTileGraphics = $00030F				; 72 bytes; 1-byte indices local to current world

!RAM_YI_Level_PauseMenuItemInventory = $000357			; 27 bytes; see SMWC for inventory item IDs

!RAM_YI_Level_TutorialMessageFlagsLo = $000372
!RAM_YI_Level_TutorialMessageFlagsHi = !RAM_YI_Level_TutorialMessageFlagsLo+$01

!RAM_YI_Level_CurrentLifeCountLo = $000379
!RAM_YI_Level_CurrentLifeCountHi = !RAM_YI_Level_CurrentLifeCountLo+$01
!RAM_YI_Level_CurrentCoinCountLo = $00037B
!RAM_YI_Level_CurrentCoinCountHi = !RAM_YI_Level_CurrentCoinCountLo+$01
!RAM_YI_Level_DeathsInCurrentLevelLo = $00037D
!RAM_YI_Level_DeathsInCurrentLevelHi = !RAM_YI_Level_DeathsInCurrentLevelLo+$01
!RAM_YI_Level_1upsCollectedInCurrentLevelLo = $00037F
!RAM_YI_Level_1upsCollectedInCurrentLevelHi = !RAM_YI_Level_1upsCollectedInCurrentLevelLo+$01

!RAM_YI_Level_CurrentYoshiColorLo = $000383
!RAM_YI_Level_CurrentYoshiColorHi = !RAM_YI_Level_CurrentYoshiColorLo+$01
!RAM_YI_Level_DoBonusChallengeFlagLo = $000385				; $0001 = no bonus, $FFFF = bonus
!RAM_YI_Level_DoBonusChallengeFlagHi = !RAM_YI_Level_DoBonusChallengeFlagLo+$01

!RAM_YI_Level_WarpToScreenFlagLo = $00038C				; warp to different screen rather than start of stage
!RAM_YI_Level_WarpToScreenFlagHi = !RAM_YI_Level_WarpToScreenFlagLo+$01
!RAM_YI_Level_CurrentScreenExitLo = $00038E				; index into screen-exit data
!RAM_YI_Level_CurrentScreenExitHi = !RAM_YI_Level_CurrentScreenExitLo+$01

!RAM_YI_Level_StarTickCounterLo = $000394				; ticks between star auto-increases when below 10
!RAM_YI_Level_StarTickCounterHi = !RAM_YI_Level_StarTickCounterLo+$01
!RAM_YI_Level_StarsPendingAutoIncreaseLo = $000396			; star count (*10) remaining to be auto-added (mid-rings + items)
!RAM_YI_Level_StarsPendingAutoIncreaseHi = !RAM_YI_Level_StarsPendingAutoIncreaseLo+$01

!RAM_YI_Level_ItemBeingUsed = $000398					; same item IDs as $000357

!RAM_YI_Level_PauseItemContinuousUseLo = $00039A			; set by star counter / egg fill, cleared on item finish
!RAM_YI_Level_PauseItemContinuousUseHi = !RAM_YI_Level_PauseItemContinuousUseLo+$01
!RAM_YI_Level_ItemUseFrameCounter = $00039C				; frame counter during item use (after unpause)

!RAM_YI_Level_StarCounterDigit1Lo = $0003A1				; first digit of on-screen star counter
!RAM_YI_Level_StarCounterDigit1Hi = !RAM_YI_Level_StarCounterDigit1Lo+$01
!RAM_YI_Level_StarCounterDigit2Lo = $0003A3				; second digit
!RAM_YI_Level_StarCounterDigit2Hi = !RAM_YI_Level_StarCounterDigit2Lo+$01

!RAM_YI_Level_GameModeFrameCounterLo = $0003A9				; gm $0D/$0E (curtain out)/$0F/$10 (in-level)/$11; paused on pause, reset on stage entry + star auto-increase
!RAM_YI_Level_GameModeFrameCounterHi = !RAM_YI_Level_GameModeFrameCounterLo+$01

!RAM_YI_Level_StarTimerBelow10Flag = $0003AB
!RAM_YI_Level_MiddleRingsTouchedLo = $0003AC
!RAM_YI_Level_MiddleRingsTouchedHi = !RAM_YI_Level_MiddleRingsTouchedLo+$01
!RAM_YI_Level_BossHasBeenVisitedBeforeFlagLo = $0003AE
!RAM_YI_Level_BossHasBeenVisitedBeforeFlagHi = !RAM_YI_Level_BossHasBeenVisitedBeforeFlagLo+$01
!RAM_YI_Level_BabyBowerHasBeenVisitedBeforeFlagLo = $0003B0
!RAM_YI_Level_BabyBowerHasBeenVisitedBeforeFlagHi = !RAM_YI_Level_BabyBowerHasBeenVisitedBeforeFlagLo+$01

!RAM_YI_Level_RedCoinsCollectedLo = $0003B4
!RAM_YI_Level_RedCoinsCollectedHi = !RAM_YI_Level_RedCoinsCollectedLo+$01
!RAM_YI_Level_StarTimerLo = $0003B6
!RAM_YI_Level_StarTimerHi = !RAM_YI_Level_StarTimerLo+$01
!RAM_YI_Level_FlowersCollectedLo = $0003B8
!RAM_YI_Level_FlowersCollectedHi = !RAM_YI_Level_FlowersCollectedLo+$01

; Checkpoint/midway re-entry page (NOT item memory, despite the ItemMemoryPage* neighbors below).
; Copied from the 2-bit header field !RAM_YI_Level_LevelHeaderItemMemorySetting ($0150) at
; room load (Bank10 CODE_unpack_level_header). Read only by the midring-restart path
; (Bank01 CODE_01E652), where it selects the (translevel, page) re-entry record via a
; (page x4) addend into DATA_level_midway_entrance_indexes. The page is set once per room
; from that room's header (warps re-unpack the sub-room's header), so there is exactly one
; re-entry record per (translevel, page), capped at 4 per translevel. The header field thus
; does double duty: collected-item bitmap bank AND this checkpoint page.
!RAM_YI_Level_CheckpointReentryPageLo = $0003BE
!RAM_YI_Level_CheckpointReentryPageHi = !RAM_YI_Level_CheckpointReentryPageLo+$01

; --- Item Memory: 4 pages x 128 bytes = 512 bytes; vertical bitplane, each word = 1 horizontal line ---
!RAM_YI_Level_ItemMemoryPage0 = $0003C0
!RAM_YI_Level_ItemMemoryPage1 = $000440
!RAM_YI_Level_ItemMemoryPage2 = $0004C0
!RAM_YI_Level_ItemMemoryPage3 = $000540

; --- Yoshi delay buffers: last 148 frames of Yoshi's position for trailing eggs (148 * 2 = 296 bytes each) ---
!RAM_YI_Player_YoshiDelayBufferIndexLo = $0005C0
!RAM_YI_Player_YoshiDelayBufferIndexHi = !RAM_YI_Player_YoshiDelayBufferIndexLo+$01
!RAM_YI_Player_YoshiXCoordDelayBuffer = $0005C2
!RAM_YI_Player_YoshiYCoordDelayBuffer = $0006EA
