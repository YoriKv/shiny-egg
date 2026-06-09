;#############################################################################################################
;# WRAM_RuntimeEffects.asm -- Title-screen anim + pause state, fuzzy effect, message box, generator flags,
;#                            opening-cutscene state machine
;#                            ($000980-$000980, $000B0F-$00112E, $0011B6-$001406).
;#############################################################################################################

!RAM_YI_TitleScreen_AnimationTimer = $000980		; updates animation frames every 4 frames (wavy text, island, sprites)

!RAM_YI_Level_CurrentPauseScreenState = $000B0F		; $00 unpaused, $01-$12 transitions, $13 in menu, $14 unpausing
!RAM_YI_Level_ActivePauseScreenFlag = $000B10		; flips at pause/unpause press

!RAM_YI_Level_CantUseItemsFlagLo = $000B48		; non-zero = menu items disabled
!RAM_YI_Level_CantUseItemsFlagHi = !RAM_YI_Level_CantUseItemsFlagLo+$01

!RAM_YI_Level_DeathCurtainXPosLo = $000B4C		; screen X of death-scene curtain; resets at $0400 (then Retry)
!RAM_YI_Level_DeathCurtainXPosHi = !RAM_YI_Level_DeathCurtainXPosLo+$01

!RAM_YI_Level_TouchedFuzzyMosaicTimerLo = $000B55	; mosaic timer; set to $10 on fuzzy touch, mirrors $095B
!RAM_YI_Level_TouchedFuzzyMosaicTimerHi = !RAM_YI_Level_TouchedFuzzyMosaicTimerLo+$01

!RAM_YI_Level_TilesetAnimationTimerLo = $000B67		; usage varies per mode
!RAM_YI_Level_TilesetAnimationTimerHi = !RAM_YI_Level_TilesetAnimationTimerLo+$01

!RAM_YI_Level_IdleFrameCounterLo = $000B7D		; >= $60 -> star counter is displayed
!RAM_YI_Level_IdleFrameCounterHi = !RAM_YI_Level_IdleFrameCounterLo+$01
!RAM_YI_Level_StarCounterDisplayTimerLo = $000B7F	; how long to keep star counter on after a change
!RAM_YI_Level_StarCounterDisplayTimerHi = !RAM_YI_Level_StarCounterDisplayTimerLo+$01
!RAM_YI_Level_StarCounterPosition = $000B81		; $00 = left side, $01 = right side

; --- Sprite morph table: 24 word-pairs (96 bytes), one per sprite slot ---
; Word 1: sprite ID to morph into when sprite state = $0006
; Word 2: unused (Goal Ring uses both as a timer)
!RAM_YI_Level_SpriteMorphTable = $000B91

;-----------------------------------------------------------------------------
; Special-sprite slot table + autoscroll state ($000C04-$000C39).
;-----------------------------------------------------------------------------

!RAM_YI_Level_NorSpr_ActiveSpecialSpritesTable = $000C04		; 4 word entries; relative ID = SprID - $01B9; $0000 = empty slot

!RAM_YI_Level_NorSpr_CurrentAutoscrollSpriteIDLo = $000C1C
!RAM_YI_Level_NorSpr_CurrentAutoscrollSpriteIDHi = !RAM_YI_Level_NorSpr_CurrentAutoscrollSpriteIDLo+$01
!RAM_YI_Level_AutoscrollXActiveFlagLo = $000C1E
!RAM_YI_Level_AutoscrollXActiveFlagHi = !RAM_YI_Level_AutoscrollXActiveFlagLo+$01
!RAM_YI_Level_AutoscrollYActiveFlagLo = $000C20
!RAM_YI_Level_AutoscrollYActiveFlagHi = !RAM_YI_Level_AutoscrollYActiveFlagLo+$01
!RAM_YI_Level_AutoscrollCameraXLo = $000C22
!RAM_YI_Level_AutoscrollCameraXHi = !RAM_YI_Level_AutoscrollCameraXLo+$01
!RAM_YI_Level_AutoscrollCameraYLo = $000C26
!RAM_YI_Level_AutoscrollCameraYHi = !RAM_YI_Level_AutoscrollCameraYLo+$01
!RAM_YI_Level_AutoscrollVelocityXLo = $000C2A
!RAM_YI_Level_AutoscrollVelocityXHi = !RAM_YI_Level_AutoscrollVelocityXLo+$01
!RAM_YI_Level_AutoscrollVelocityYLo = $000C2C
!RAM_YI_Level_AutoscrollVelocityYHi = !RAM_YI_Level_AutoscrollVelocityYLo+$01
!RAM_YI_Level_AutoscrollCheckpointIndexLo = $000C2E
!RAM_YI_Level_AutoscrollCheckpointIndexHi = !RAM_YI_Level_AutoscrollCheckpointIndexLo+$01
!RAM_YI_Level_AutoscrollNextCheckpointXLo = $000C30
!RAM_YI_Level_AutoscrollNextCheckpointXHi = !RAM_YI_Level_AutoscrollNextCheckpointXLo+$01
!RAM_YI_Level_AutoscrollNextCheckpointYLo = $000C32
!RAM_YI_Level_AutoscrollNextCheckpointYHi = !RAM_YI_Level_AutoscrollNextCheckpointYLo+$01
!RAM_YI_Level_AutoscrollNextCheckpointSpeedLo = $000C34
!RAM_YI_Level_AutoscrollNextCheckpointSpeedHi = !RAM_YI_Level_AutoscrollNextCheckpointSpeedLo+$01
!RAM_YI_Level_AutoscrollXDeltaToCheckpointLo = $000C36
!RAM_YI_Level_AutoscrollXDeltaToCheckpointHi = !RAM_YI_Level_AutoscrollXDeltaToCheckpointLo+$01
!RAM_YI_Level_AutoscrollYDeltaToCheckpointLo = $000C38
!RAM_YI_Level_AutoscrollYDeltaToCheckpointHi = !RAM_YI_Level_AutoscrollYDeltaToCheckpointLo+$01

!RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagLo = $000C3A
!RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagHi = !RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagLo+$01
!RAM_YI_Level_NorSpr_LakituActiveFlagLo = $000C3C
!RAM_YI_Level_NorSpr_LakituActiveFlagHi = !RAM_YI_Level_NorSpr_LakituActiveFlagLo+$01
!RAM_YI_Level_NorSpr_FuzzyGeneratorActiveFlagLo = $000C3E
!RAM_YI_Level_NorSpr_FuzzyGeneratorActiveFlagHi = !RAM_YI_Level_NorSpr_FuzzyGeneratorActiveFlagLo+$01

!RAM_YI_Level_NorSpr_PoochyExistsFlagLo = $000C46
!RAM_YI_Level_NorSpr_PoochyExistsFlagHi = !RAM_YI_Level_NorSpr_PoochyExistsFlagLo+$01
!RAM_YI_Level_NorSpr_BatGeneratorActiveFlagLo = $000C48
!RAM_YI_Level_NorSpr_BatGeneratorActiveFlagHi = !RAM_YI_Level_NorSpr_BatGeneratorActiveFlagLo+$01
!RAM_YI_Level_NorSpr_SpawnedBatGeneratorBatsLo = $000C4A
!RAM_YI_Level_NorSpr_SpawnedBatGeneratorBatsHi = !RAM_YI_Level_NorSpr_SpawnedBatGeneratorBatsLo+$01

!RAM_YI_Level_NorSpr_FireLakituActiveFlagLo = $000C68
!RAM_YI_Level_NorSpr_FireLakituActiveFlagHi = !RAM_YI_Level_NorSpr_FireLakituActiveFlagLo+$01
!RAM_YI_Level_NorSpr_FlutterGeneratorActiveFlagLo = $000C6A
!RAM_YI_Level_NorSpr_FlutterGeneratorActiveFlagHi = !RAM_YI_Level_NorSpr_FlutterGeneratorActiveFlagLo+$01

!RAM_YI_Level_NorSpr_NipperSporeGeneratorActiveFlagLo = $000C6E
!RAM_YI_Level_NorSpr_NipperSporeGeneratorActiveFlagHi = !RAM_YI_Level_NorSpr_NipperSporeGeneratorActiveFlagLo+$01
!RAM_YI_Level_NorSpr_PokeyBalloonGeneratorActiveFlagLo = $000C70
!RAM_YI_Level_NorSpr_PokeyBalloonGeneratorActiveFlagHi = !RAM_YI_Level_NorSpr_PokeyBalloonGeneratorActiveFlagLo+$01
!RAM_YI_Level_NorSpr_MissileBalloonGeneratorActiveFlagLo = $000C72
!RAM_YI_Level_NorSpr_MissileBalloonGeneratorActiveFlagHi = !RAM_YI_Level_NorSpr_MissileBalloonGeneratorActiveFlagLo+$01
!RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagLo = $000C74
!RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagHi = !RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagLo+$01
!RAM_YI_Level_NorSpr_PlatformGeneratorActiveFlagLo = $000C76
!RAM_YI_Level_NorSpr_PlatformGeneratorActiveFlagHi = !RAM_YI_Level_NorSpr_PlatformGeneratorActiveFlagLo+$01
!RAM_YI_Level_NorSpr_SlimeGeneratorActiveFlagLo = $000C78
!RAM_YI_Level_NorSpr_SlimeGeneratorActiveFlagHi = !RAM_YI_Level_NorSpr_SlimeGeneratorActiveFlagLo+$01

;-----------------------------------------------------------------------------
; Tongue position (relative to Yoshi), camera shake, falling-wall flag,
; sprite-state copy table used during camera events ($000C80-$000CB3).
;-----------------------------------------------------------------------------

!RAM_YI_Player_TongueXPosLo = $000C80
!RAM_YI_Player_TongueXPosHi = !RAM_YI_Player_TongueXPosLo+$01
!RAM_YI_Player_TongueYPosLo = $000C82
!RAM_YI_Player_TongueYPosHi = !RAM_YI_Player_TongueYPosLo+$01

!RAM_YI_Level_NorSpr_StatesDuringCameraEventTable = $000C98		; 24-entry copy of sprite states preserved across camera events (one byte each)

!RAM_YI_Level_CameraYShakeOffsetLo = $000CB0
!RAM_YI_Level_CameraYShakeOffsetHi = !RAM_YI_Level_CameraYShakeOffsetLo+$01
!RAM_YI_Level_NorSpr_FallingWallOnScreenFlagLo = $000CB2
!RAM_YI_Level_NorSpr_FallingWallOnScreenFlagHi = !RAM_YI_Level_NorSpr_FallingWallOnScreenFlagLo+$01

!RAM_YI_Player_DamageRecoilTimerLo = $000CCC
!RAM_YI_Player_DamageRecoilTimerHi = !RAM_YI_Player_DamageRecoilTimerLo+$01

!RAM_YI_Level_RedSwitchTimer = $000CEC

!RAM_YI_Level_PauseScreenCursorLoc1 = $000CF4
!RAM_YI_Level_PauseScreenCursorLoc2 = $000CF5

!RAM_YI_Level_FuzzyEffectAmplitudeLo = $000CFF
!RAM_YI_Level_FuzzyEffectAmplitudeHi = !RAM_YI_Level_FuzzyEffectAmplitudeLo+$01
!RAM_YI_Level_FuzzyEffectPositionOffsetLo = $000D01
!RAM_YI_Level_FuzzyEffectPositionOffsetHi = !RAM_YI_Level_FuzzyEffectPositionOffsetLo+$01
!RAM_YI_Level_FuzzyEffectFrameCounterLo = $000D03
!RAM_YI_Level_FuzzyEffectFrameCounterHi = !RAM_YI_Level_FuzzyEffectFrameCounterLo+$01

!RAM_YI_Level_OffsetByTileTimerLo = $000CFD
!RAM_YI_Level_OffsetByTileTimerHi = !RAM_YI_Level_OffsetByTileTimerLo+$01

!RAM_YI_Level_RaphaelRotationValue = $000D05			; whole-loop rotation, $00-$FF

;-----------------------------------------------------------------------------
; Background gradient + message box + level-clear wipe + fuzzy BG wave
; ($000D09-$000D3A).
;-----------------------------------------------------------------------------

!RAM_YI_Level_BGGradientYScrollLowerLo = $000D09
!RAM_YI_Level_BGGradientYScrollLowerHi = !RAM_YI_Level_BGGradientYScrollLowerLo+$01
!RAM_YI_Level_BGGradientYScrollUpperLo = $000D0B
!RAM_YI_Level_BGGradientYScrollUpperHi = !RAM_YI_Level_BGGradientYScrollUpperLo+$01

!RAM_YI_Level_MessageBoxState = $000D0F
!RAM_YI_Level_MessageBoxBlackMaskSizeLo = $000D19
!RAM_YI_Level_MessageBoxBlackMaskSizeHi = !RAM_YI_Level_MessageBoxBlackMaskSizeLo+$01

!RAM_YI_Level_StageClearWipeLeftXLo = $000D21		; word 1 low: left X / high: right X
!RAM_YI_Level_StageClearWipeLeftXHi = !RAM_YI_Level_StageClearWipeLeftXLo+$01
!RAM_YI_Level_StageClearWipeTopYLo = $000D23
!RAM_YI_Level_StageClearWipeTopYHi = !RAM_YI_Level_StageClearWipeTopYLo+$01
!RAM_YI_Level_StageClearWipeBottomYLo = $000D25
!RAM_YI_Level_StageClearWipeBottomYHi = !RAM_YI_Level_StageClearWipeBottomYLo+$01

!RAM_YI_Level_FuzzyBGWaveHAmpLo = $000D37
!RAM_YI_Level_FuzzyBGWaveHAmpHi = !RAM_YI_Level_FuzzyBGWaveHAmpLo+$01
!RAM_YI_Level_FuzzyBGWaveVAmpLo = $000D39
!RAM_YI_Level_FuzzyBGWaveVAmpHi = !RAM_YI_Level_FuzzyBGWaveVAmpLo+$01

;-----------------------------------------------------------------------------
; Baby Mario hold-direction animation counters ($000DAE-$000DB1).
;-----------------------------------------------------------------------------

!RAM_YI_Player_BabyMarioHoldUpCounterLo = $000DAE
!RAM_YI_Player_BabyMarioHoldUpCounterHi = !RAM_YI_Player_BabyMarioHoldUpCounterLo+$01
!RAM_YI_Player_BabyMarioHoldDownCounterLo = $000DB0
!RAM_YI_Player_BabyMarioHoldDownCounterHi = !RAM_YI_Player_BabyMarioHoldDownCounterLo+$01

;-----------------------------------------------------------------------------
; Wooden-plank sprite count + Red Toadie cluster ($000DF9-$000E58).
;-----------------------------------------------------------------------------

!RAM_YI_Level_NorSpr_WoodenPlankCountLo = $000DF9		; running count of sprites $5E/$5F
!RAM_YI_Level_NorSpr_WoodenPlankCountHi = !RAM_YI_Level_NorSpr_WoodenPlankCountLo+$01

!RAM_YI_Level_NorSpr_RedToadieGrabbedCount = $000E2F		; how many of the 4 have grabbed Baby Mario
!RAM_YI_Level_NorSpr_RedToadieActiveCount = $000E31		; how many of the 4 are currently spawned
!RAM_YI_Level_NorSpr_RedToadieAnyActiveFlag = $000E33		; set if at least one Toadie is active
!RAM_YI_Level_NorSpr_RedToadieXPosTable = $000E37		; 16 bytes: 4 entries x (subpx,pos,screen,carry)
!RAM_YI_Level_NorSpr_RedToadieYPosTable = $000E49		; 16 bytes: 4 entries x (subpx,pos,screen,carry)

;-----------------------------------------------------------------------------
; Spiked-platform frame-counter mirrors ($000FBD-$000FC0).
;-----------------------------------------------------------------------------

!RAM_YI_Level_NorSpr_GreenSpikedPlatformTimerLo = $000FBD	; mirror of $701974 while sprite $15F active
!RAM_YI_Level_NorSpr_GreenSpikedPlatformTimerHi = !RAM_YI_Level_NorSpr_GreenSpikedPlatformTimerLo+$01
!RAM_YI_Level_NorSpr_RedSpikedPlatformTimerLo = $000FBF		; mirror of $701974 while sprite $160 active
!RAM_YI_Level_NorSpr_RedSpikedPlatformTimerHi = !RAM_YI_Level_NorSpr_RedSpikedPlatformTimerLo+$01

;-----------------------------------------------------------------------------
; Kamek-spell handshake ($001015). 16-bit signal between boss state machines
; and the CutsceneKamek sprite (NorSpr048, Bank0C). Protocol:
;   1. Boss prep writes positive (INC or =$0001) before spawning Kamek.
;   2. CutsceneKamek state $00 wakes on non-zero; state $0D writes $FFFF
;      when its spell-throw cinema completes.
;   3. Boss "wait for Kamek" state BPLs while positive; on negative, does
;      STZ + INC state byte to consume + advance.
;   4. CutsceneKamek state $0E waits for the STZ before despawning.
; Writers: Hookbill (Bank01), Baby Bowser (Bank0D), Sluggy (Bank02), Tap-Tap
; (Bank0F), Naval Piranha; CutsceneKamek main (Bank0C $11927 / $12856). See
; bossengine.md Sec. 10.3 for the full protocol.
;-----------------------------------------------------------------------------

!RAM_YI_Level_KamekSpellHandshake = $001015

;-----------------------------------------------------------------------------
; Boss WRAM block ($00105C-$001083). Multiplexed per boss; see bossengine.md.
;-----------------------------------------------------------------------------

!RAM_YI_Level_NorSpr_RaphaelYOnMoon = $00105C			; Y coordinate relative to moon surface
!RAM_YI_Level_NorSpr_RaphaelXOnMoon = $00105D			; X coordinate wrapping around moon
!RAM_YI_Level_NorSpr_BiggerBooScale = $00105E			; Bigger Boo: scale. Also Raphael distance from Yoshi (lo), Raphael AI state (hi)
!RAM_YI_Level_NorSpr_RaphaelTimer = $001060			; per-state countdown, randomised on transitions
!RAM_YI_Level_NorSpr_RaphaelFacing = $001062			; $00 = CCW, $02 = CW. Also Baby Bowser hit counter ($03-$82 ends fight)
!RAM_YI_Level_NorSpr_BiggerBooDamageGrowFlag = $001066		; set while growing from a hit
!RAM_YI_Level_NorSpr_BigBowserZLo = $001068			; depth coordinate (Mode-7 Z)
!RAM_YI_Level_NorSpr_BigBowserZHi = !RAM_YI_Level_NorSpr_BigBowserZLo+$01
!RAM_YI_Level_NorSpr_BigBowserXLo = $00106C			; Mode-7 horizontal position. Also Raphael Y velocity
!RAM_YI_Level_NorSpr_BigBowserXHi = !RAM_YI_Level_NorSpr_BigBowserXLo+$01
!RAM_YI_Level_NorSpr_BigBowserBoulderSummonIndexLo = $001070	; +2 per boulder, ends $0008/$000E on the two summons
!RAM_YI_Level_NorSpr_BigBowserBoulderSummonIndexHi = !RAM_YI_Level_NorSpr_BigBowserBoulderSummonIndexLo+$01
!RAM_YI_Level_NorSpr_BigBowserHitByEggFlagLo = $001074		; auto-clears each frame
!RAM_YI_Level_NorSpr_BigBowserHitByEggFlagHi = !RAM_YI_Level_NorSpr_BigBowserHitByEggFlagLo+$01
!RAM_YI_Level_NorSpr_HookbillScaleXLo = $001076			; also Bowser damage counter (ends at $0007)
!RAM_YI_Level_NorSpr_HookbillScaleXHi = !RAM_YI_Level_NorSpr_HookbillScaleXLo+$01
!RAM_YI_Level_NorSpr_HookbillScaleYLo = $001078
!RAM_YI_Level_NorSpr_HookbillScaleYHi = !RAM_YI_Level_NorSpr_HookbillScaleYLo+$01
!RAM_YI_Level_NorSpr_HookbillBodypoundHits = $00107C		; cumulative egg-hits on grounded Hookbill (advances 0/2/4/6; $06 = defeat). See bossengine.md Sec. 10.5.
!RAM_YI_Level_NorSpr_HookbillBodypoundHitsAtPhaseStart = $00107E	; snapshot of $107C latched when Hookbill becomes grounded; gates one hit per phase via CPY/BNE.
!RAM_YI_Level_NorSpr_NavalPiranhaHealthLo = $001082		; starts $0003, dies on $0000
!RAM_YI_Level_NorSpr_NavalPiranhaHealthHi = !RAM_YI_Level_NorSpr_NavalPiranhaHealthLo+$01

!RAM_YI_Level_FreeMovementFlag = $0010DA

;-----------------------------------------------------------------------------
; World-map cursor + selection state ($001109-$00112F).
;-----------------------------------------------------------------------------

!RAM_YI_Map_CursorXPos = $001109
!RAM_YI_Map_CursorYPos = $00110A
!RAM_YI_Map_CursorNextXPos = $00110C
!RAM_YI_Map_CursorNextYPos = $00110D
!RAM_YI_Map_CurrentLevelSlot = $001112				; selecting one sets $7E021A
!RAM_YI_Map_CurrentWorldDoubled = $001117			; world * 2, sets $7E0218
!RAM_YI_Map_CurrentYoshiFormationLo = $001125			; follows world-number format
!RAM_YI_Map_CurrentYoshiFormationHi = !RAM_YI_Map_CurrentYoshiFormationLo+$01

!RAM_YI_Map_RunningYoshiIndex = $00112E

;-----------------------------------------------------------------------------
; Opening-cutscene state machine ($0011B6-$001406).
;-----------------------------------------------------------------------------

!RAM_YI_Cutscene_StoryTextFramesRemainingLo = $0011B6
!RAM_YI_Cutscene_StoryTextFramesRemainingHi = !RAM_YI_Cutscene_StoryTextFramesRemainingLo+$01
!RAM_YI_Cutscene_StoryStateLo = $0011B8				; $01 load next/init fade, $02 fade-in, $03 display, $04 load next/scroll, $05 scroll, $06 fade-out
!RAM_YI_Cutscene_StoryStateHi = !RAM_YI_Cutscene_StoryStateLo+$01
!RAM_YI_Cutscene_StoryCurrentTextIndexLo = $0011BA		; index by 2's into $0FCD56
!RAM_YI_Cutscene_StoryCurrentTextIndexHi = !RAM_YI_Cutscene_StoryCurrentTextIndexLo+$01
!RAM_YI_Cutscene_StoryBG4TilemapDestLo = $0011BC		; BG4 tilemap VRAM destination for text DMA
!RAM_YI_Cutscene_StoryBG4TilemapDestHi = !RAM_YI_Cutscene_StoryBG4TilemapDestLo+$01
!RAM_YI_Cutscene_StoryBG4TilemapDataBuffer = $0011BE		; 576 bytes; 64-byte chunks DMA'd to VRAM as text changes
!RAM_YI_Cutscene_StoryCurrentYScrollDest = $0013FE		; index by 2's into $0FCE90
!RAM_YI_Cutscene_StoryFrameTimingIndex = $001404		; index into cutscene timer table $0FCEDB
!RAM_YI_Cutscene_StoryAndIslandSwitchTimerLo = $001405		; counts down; fade between cutscene and rotating-island scenes
!RAM_YI_Cutscene_StoryAndIslandSwitchTimerHi = !RAM_YI_Cutscene_StoryAndIslandSwitchTimerLo+$01
