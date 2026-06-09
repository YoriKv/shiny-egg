;#############################################################################################################
;# SRAM_Player.asm -- Yoshi position, state, form, animations, egg-throw, ammo ($00008A-$0001F5).
;#############################################################################################################

!EXRAM_YI_Player_SubXPosLo #= $00008A|!SRAMBankBaseAddress
!EXRAM_YI_Player_SubXPosHi = !EXRAM_YI_Player_SubXPosLo+$01
!EXRAM_YI_Player_XPosLo #= $00008C|!SRAMBankBaseAddress
!EXRAM_YI_Player_XPosHi = !EXRAM_YI_Player_XPosLo+$01
!EXRAM_YI_Player_SubYPosLo #= $00008E|!SRAMBankBaseAddress
!EXRAM_YI_Player_SubYPosHi = !EXRAM_YI_Player_SubYPosLo+$01
!EXRAM_YI_Player_YPosLo #= $000090|!SRAMBankBaseAddress
!EXRAM_YI_Player_YPosHi = !EXRAM_YI_Player_YPosLo+$01

;-- Free OAM slot pointer (next entry to write into the OAM buffer at $700200).
!EXRAM_YI_Global_OAMNextFreeSlotPtrLo #= $000092|!SRAMBankBaseAddress
!EXRAM_YI_Global_OAMNextFreeSlotPtrHi = !EXRAM_YI_Global_OAMNextFreeSlotPtrLo+$01

!EXRAM_YI_Global_Layer1XPosLo #= $000094|!SRAMBankBaseAddress
!EXRAM_YI_Global_Layer1XPosHi = !EXRAM_YI_Global_Layer1XPosLo+$01
!EXRAM_YI_Global_Layer2XPosLo #= $000096|!SRAMBankBaseAddress
!EXRAM_YI_Global_Layer2XPosHi = !EXRAM_YI_Global_Layer2XPosLo+$01
!EXRAM_YI_Global_Layer3XPosLo #= $000098|!SRAMBankBaseAddress
!EXRAM_YI_Global_Layer3XPosHi = !EXRAM_YI_Global_Layer3XPosLo+$01
!EXRAM_YI_Global_Layer4XPosLo #= $00009A|!SRAMBankBaseAddress
!EXRAM_YI_Global_Layer4XPosHi = !EXRAM_YI_Global_Layer4XPosLo+$01
!EXRAM_YI_Global_Layer1YPosLo #= $00009C|!SRAMBankBaseAddress
!EXRAM_YI_Global_Layer1YPosHi = !EXRAM_YI_Global_Layer1YPosLo+$01
!EXRAM_YI_Global_Layer2YPosLo #= $00009E|!SRAMBankBaseAddress
!EXRAM_YI_Global_Layer2YPosHi = !EXRAM_YI_Global_Layer2YPosLo+$01
!EXRAM_YI_Global_Layer3YPosLo #= $0000A0|!SRAMBankBaseAddress
!EXRAM_YI_Global_Layer3YPosHi = !EXRAM_YI_Global_Layer3YPosLo+$01
!EXRAM_YI_Global_Layer4YPosLo #= $0000A2|!SRAMBankBaseAddress
!EXRAM_YI_Global_Layer4YPosHi = !EXRAM_YI_Global_Layer4YPosLo+$01

;-- Topmost/leftmost on-screen tile positions (camera-derived).
!EXRAM_YI_Global_LeftmostTileXLo #= $0000A4|!SRAMBankBaseAddress
!EXRAM_YI_Global_LeftmostTileXHi = !EXRAM_YI_Global_LeftmostTileXLo+$01
!EXRAM_YI_Global_UppermostTileYLo #= $0000A6|!SRAMBankBaseAddress
!EXRAM_YI_Global_UppermostTileYHi = !EXRAM_YI_Global_UppermostTileYLo+$01

;-- Previous frame's X velocity ($A8) + current frame Y velocity ($AA).
!EXRAM_YI_Player_PrevXVelocityLo #= $0000A8|!SRAMBankBaseAddress
!EXRAM_YI_Player_PrevXVelocityHi = !EXRAM_YI_Player_PrevXVelocityLo+$01
!EXRAM_YI_Player_YVelocityLo #= $0000AA|!SRAMBankBaseAddress
!EXRAM_YI_Player_YVelocityHi = !EXRAM_YI_Player_YVelocityLo+$01

!EXRAM_YI_Player_CurrentStateLo #= $0000AC|!SRAMBankBaseAddress
!EXRAM_YI_Player_CurrentStateHi = !EXRAM_YI_Player_CurrentStateLo+$01
!EXRAM_YI_Player_CurrentFormLo #= $0000AE|!SRAMBankBaseAddress
!EXRAM_YI_Player_CurrentFormHi = !EXRAM_YI_Player_CurrentFormLo+$01

;-- Camera-relative position + current X velocity + ground/slope angles.
!EXRAM_YI_Player_XPosRelCamLo #= $0000B0|!SRAMBankBaseAddress
!EXRAM_YI_Player_XPosRelCamHi = !EXRAM_YI_Player_XPosRelCamLo+$01
!EXRAM_YI_Player_YPosRelCamLo #= $0000B2|!SRAMBankBaseAddress
!EXRAM_YI_Player_YPosRelCamHi = !EXRAM_YI_Player_YPosRelCamLo+$01
!EXRAM_YI_Player_XVelocityLo #= $0000B4|!SRAMBankBaseAddress
!EXRAM_YI_Player_XVelocityHi = !EXRAM_YI_Player_XVelocityLo+$01
!EXRAM_YI_Player_GroundAngleLo #= $0000B6|!SRAMBankBaseAddress
!EXRAM_YI_Player_GroundAngleHi = !EXRAM_YI_Player_GroundAngleLo+$01
!EXRAM_YI_Player_TopSlopeAngleLo #= $0000B8|!SRAMBankBaseAddress
!EXRAM_YI_Player_TopSlopeAngleHi = !EXRAM_YI_Player_TopSlopeAngleLo+$01
!EXRAM_YI_Player_MidSlopeAngleLo #= $0000BA|!SRAMBankBaseAddress
!EXRAM_YI_Player_MidSlopeAngleHi = !EXRAM_YI_Player_MidSlopeAngleLo+$01
!EXRAM_YI_Player_LowSlopeAngleLo #= $0000BC|!SRAMBankBaseAddress
!EXRAM_YI_Player_LowSlopeAngleHi = !EXRAM_YI_Player_LowSlopeAngleLo+$01
!EXRAM_YI_Player_CurrentAnimFrameLo #= $0000BE|!SRAMBankBaseAddress
!EXRAM_YI_Player_CurrentAnimFrameHi = !EXRAM_YI_Player_CurrentAnimFrameLo+$01

!EXRAM_YI_Player_CurrentJumpStateLo #= $0000C0|!SRAMBankBaseAddress
!EXRAM_YI_Player_CurrentJumpStateHi = !EXRAM_YI_Player_CurrentJumpStateLo+$01
!EXRAM_YI_Player_CurrentDuckStateLo #= $0000C2|!SRAMBankBaseAddress
!EXRAM_YI_Player_CurrentDuckStateHi = !EXRAM_YI_Player_CurrentDuckStateLo+$01
!EXRAM_YI_Player_FacingDirectionLo #= $0000C4|!SRAMBankBaseAddress
!EXRAM_YI_Player_FacingDirectionHi = !EXRAM_YI_Player_FacingDirectionLo+$01
!EXRAM_YI_Player_CurrentSwimStateLo #= $0000C6|!SRAMBankBaseAddress
!EXRAM_YI_Player_CurrentSwimStateHi = !EXRAM_YI_Player_CurrentSwimStateLo+$01

;-- Last input-driven acceleration direction ($00=none, $01=right, $02=left).
!EXRAM_YI_Player_LastAccelDirection #= $0000CC|!SRAMBankBaseAddress
;-- $004C while holding Up on ground, else $0000.
!EXRAM_YI_Player_HoldingUpFlagLo #= $0000CE|!SRAMBankBaseAddress
!EXRAM_YI_Player_HoldingUpFlagHi = !EXRAM_YI_Player_HoldingUpFlagLo+$01

!EXRAM_YI_Player_CurrentFlutterState #= $0000D2|!SRAMBankBaseAddress
!EXRAM_YI_Player_ExtendedFlutterFlag #= $0000D3|!SRAMBankBaseAddress
!EXRAM_YI_Player_CurrentGroundPoundStateLo #= $0000D4|!SRAMBankBaseAddress
!EXRAM_YI_Player_CurrentGroundPoundStateHi = !EXRAM_YI_Player_CurrentGroundPoundStateLo+$01
!EXRAM_YI_Player_HoldDownToGroundPoundTimerLo #= $0000D6|!SRAMBankBaseAddress
!EXRAM_YI_Player_HoldDownToGroundPoundTimerHi = !EXRAM_YI_Player_HoldDownToGroundPoundTimerLo+$01

;-- Stair-step counter (high byte used): $0800..$0100 = left-facing; $F800..$FF00 = right-facing.
!EXRAM_YI_Player_StairStateLo #= $0000DA|!SRAMBankBaseAddress
!EXRAM_YI_Player_StairStateHi = !EXRAM_YI_Player_StairStateLo+$01
;-- Wall-push / pushable-sprite animation counter (loops at $23 / $24).
!EXRAM_YI_Player_PushingCounterLo #= $0000DC|!SRAMBankBaseAddress
!EXRAM_YI_Player_PushingCounterHi = !EXRAM_YI_Player_PushingCounterLo+$01

;-- Egg-throw state machine ($0007..$000A init, $0006 ready-to-throw, decrements to $0).
!EXRAM_YI_Player_EggThrowStateMachineLo #= $0000DE|!SRAMBankBaseAddress
!EXRAM_YI_Player_EggThrowStateMachineHi = !EXRAM_YI_Player_EggThrowStateMachineLo+$01
;-- Egg cursor radius (subpixel low byte, pixel high byte).
!EXRAM_YI_Player_EggCursorRadiusLo #= $0000E0|!SRAMBankBaseAddress
!EXRAM_YI_Player_EggCursorRadiusHi = !EXRAM_YI_Player_EggCursorRadiusLo+$01
;-- Egg cursor screen position.
!EXRAM_YI_Player_EggCursorXLo #= $0000E4|!SRAMBankBaseAddress
!EXRAM_YI_Player_EggCursorXHi = !EXRAM_YI_Player_EggCursorXLo+$01
!EXRAM_YI_Player_EggCursorYLo #= $0000E6|!SRAMBankBaseAddress
!EXRAM_YI_Player_EggCursorYHi = !EXRAM_YI_Player_EggCursorYLo+$01
;-- Hold-Down-to-cancel-egg-throw counter (counts up to $0007 then cancels).
!EXRAM_YI_Player_EggCancelCounterLo #= $0000E8|!SRAMBankBaseAddress
!EXRAM_YI_Player_EggCancelCounterHi = !EXRAM_YI_Player_EggCancelCounterLo+$01
;-- $FFFF when egg cursor is L/R-locked, $0000 when unlocked.
!EXRAM_YI_Player_EggCursorLockedFlagLo #= $0000EA|!SRAMBankBaseAddress
!EXRAM_YI_Player_EggCursorLockedFlagHi = !EXRAM_YI_Player_EggCursorLockedFlagLo+$01

!EXRAM_YI_Player_CanAimEggFlagLo #= $0000EC|!SRAMBankBaseAddress
!EXRAM_YI_Player_CanAimEggFlagHi = !EXRAM_YI_Player_CanAimEggFlagLo+$01
!EXRAM_YI_Player_EggAimAngleLo #= $0000EE|!SRAMBankBaseAddress
!EXRAM_YI_Player_EggAimAngleHi = !EXRAM_YI_Player_EggAimAngleLo+$01

;-- Angular velocity of egg cursor (fixed-point).
!EXRAM_YI_Player_EggCursorAngVelLo #= $0000F0|!SRAMBankBaseAddress
!EXRAM_YI_Player_EggCursorAngVelHi = !EXRAM_YI_Player_EggCursorAngVelLo+$01
;-- Fuzzy-state stumble amount ($001A fwd / $FFE6 back trigger) and lean direction.
!EXRAM_YI_Player_FuzzyStumbleAmountLo #= $0000F2|!SRAMBankBaseAddress
!EXRAM_YI_Player_FuzzyStumbleAmountHi = !EXRAM_YI_Player_FuzzyStumbleAmountLo+$01
!EXRAM_YI_Player_FuzzyStumbleDirLo #= $0000F4|!SRAMBankBaseAddress
!EXRAM_YI_Player_FuzzyStumbleDirHi = !EXRAM_YI_Player_FuzzyStumbleDirLo+$01

!EXRAM_YI_Player_CurrentIdleAnimationLo #= $0000F6|!SRAMBankBaseAddress
!EXRAM_YI_Player_CurrentIdleAnimationHi = !EXRAM_YI_Player_CurrentIdleAnimationLo+$01

;-- Running-anim cycle (alternates $0000/$0002 during pre-/post-run, $0000..$0012 step $02).
!EXRAM_YI_Player_RunAnimStateLo #= $0000F8|!SRAMBankBaseAddress
!EXRAM_YI_Player_RunAnimStateHi = !EXRAM_YI_Player_RunAnimStateLo+$01

;-- Ground-type Yoshi is on ($0=ground, $1=water, $3=ice, $4=snow, $5=mud).
!EXRAM_YI_Player_GroundTypeLo #= $0000FA|!SRAMBankBaseAddress
!EXRAM_YI_Player_GroundTypeHi = !EXRAM_YI_Player_GroundTypeLo+$01
;-- Player collision bitfields (terrain / water / cross-section) share LlRrTtBMb format.
!EXRAM_YI_Player_TerrainCollLo #= $0000FC|!SRAMBankBaseAddress
!EXRAM_YI_Player_TerrainCollHi = !EXRAM_YI_Player_TerrainCollLo+$01
!EXRAM_YI_Player_WaterCollLo #= $0000FE|!SRAMBankBaseAddress
!EXRAM_YI_Player_WaterCollHi = !EXRAM_YI_Player_WaterCollLo+$01
!EXRAM_YI_Player_CrossCollLo #= $000100|!SRAMBankBaseAddress
!EXRAM_YI_Player_CrossCollHi = !EXRAM_YI_Player_CrossCollLo+$01
;-- $0001 when standing on a Spiky Stake, else $0000.
!EXRAM_YI_Player_OnSpikyStakeFlagLo #= $000102|!SRAMBankBaseAddress
!EXRAM_YI_Player_OnSpikyStakeFlagHi = !EXRAM_YI_Player_OnSpikyStakeFlagLo+$01

;-- Door exit type ($0000 regular, $0100 sewer hole, $FFFF mini-game).
!EXRAM_YI_Level_DoorExitTypeLo #= $000104|!SRAMBankBaseAddress
!EXRAM_YI_Level_DoorExitTypeHi = !EXRAM_YI_Level_DoorExitTypeLo+$01
;-- Pipe entrance/exit type: low byte = direction ($02/$04/$06/$08), high byte = orientation
;-- ($00/$40 vertical in/out, $80/$C0 horizontal in/out).
!EXRAM_YI_Level_PipeTransitionTypeLo #= $000106|!SRAMBankBaseAddress
!EXRAM_YI_Level_PipeTransitionTypeHi #= $000107|!SRAMBankBaseAddress
;-- Distance travelled in pipe transition ($ppss). Fade/exit at $1F00.
!EXRAM_YI_Level_PipeTransitionDistLo #= $000108|!SRAMBankBaseAddress
!EXRAM_YI_Level_PipeTransitionDistHi = !EXRAM_YI_Level_PipeTransitionDistLo+$01
!EXRAM_YI_Player_PipeAnimStateLo #= $00010A|!SRAMBankBaseAddress
!EXRAM_YI_Player_PipeAnimStateHi = !EXRAM_YI_Player_PipeAnimStateLo+$01
!EXRAM_YI_Player_PipeEnterAccelLo #= $00010C|!SRAMBankBaseAddress
!EXRAM_YI_Player_PipeEnterAccelHi = !EXRAM_YI_Player_PipeEnterAccelLo+$01
!EXRAM_YI_Player_PipeXPosRelLo #= $00010E|!SRAMBankBaseAddress
!EXRAM_YI_Player_PipeXPosRelHi = !EXRAM_YI_Player_PipeXPosRelLo+$01

;-- Mud/snow particle ticker (mirror of running anim) / mud-slide distance counter (wraps $1FFF).
!EXRAM_YI_Player_MudSnowParticleLo #= $000110|!SRAMBankBaseAddress
!EXRAM_YI_Player_MudSnowParticleHi = !EXRAM_YI_Player_MudSnowParticleLo+$01
;-- Car-Yoshi wheel-extension height (increments by 2, caps at $0030).
!EXRAM_YI_Player_CarWheelExtensionLo #= $000112|!SRAMBankBaseAddress
!EXRAM_YI_Player_CarWheelExtensionHi = !EXRAM_YI_Player_CarWheelExtensionLo+$01
;-- ROM graphics source (bank $52) DMA'd into VRAM at $4200-$43FF for tongue / star-egg / bubble.
!EXRAM_YI_Player_TongueGfxDMASrcLo #= $000114|!SRAMBankBaseAddress
!EXRAM_YI_Player_TongueGfxDMASrcHi = !EXRAM_YI_Player_TongueGfxDMASrcLo+$01

;-- Pointer into OAM buffer for the "above-Yoshi" sprite layer + that layer's priority #.
!EXRAM_YI_Player_AboveLayerOAMPtrLo #= $000118|!SRAMBankBaseAddress
!EXRAM_YI_Player_AboveLayerOAMPtrHi = !EXRAM_YI_Player_AboveLayerOAMPtrLo+$01
!EXRAM_YI_Player_AboveLayerPriorityLo #= $00011A|!SRAMBankBaseAddress
!EXRAM_YI_Player_AboveLayerPriorityHi = !EXRAM_YI_Player_AboveLayerPriorityLo+$01

;-- Yoshi hitbox center + half-extents (used for tile collision, sprite collision).
!EXRAM_YI_Player_CenterXLo #= $00011C|!SRAMBankBaseAddress
!EXRAM_YI_Player_CenterXHi = !EXRAM_YI_Player_CenterXLo+$01
!EXRAM_YI_Player_CenterYLo #= $00011E|!SRAMBankBaseAddress
!EXRAM_YI_Player_CenterYHi = !EXRAM_YI_Player_CenterYLo+$01
!EXRAM_YI_Player_HitboxHalfWidthLo #= $000120|!SRAMBankBaseAddress
!EXRAM_YI_Player_HitboxHalfWidthHi = !EXRAM_YI_Player_HitboxHalfWidthLo+$01
!EXRAM_YI_Player_HitboxHalfHeightLo #= $000122|!SRAMBankBaseAddress
!EXRAM_YI_Player_HitboxHalfHeightHi = !EXRAM_YI_Player_HitboxHalfHeightLo+$01

;-- Yoshi OAM palette (----ccc-) and priority (--pp----), low byte of yxppccct.
!EXRAM_YI_Player_OAMPaletteLo #= $000124|!SRAMBankBaseAddress
!EXRAM_YI_Player_OAMPaletteHi = !EXRAM_YI_Player_OAMPaletteLo+$01
!EXRAM_YI_Player_OAMPriorityLo #= $000126|!SRAMBankBaseAddress
!EXRAM_YI_Player_OAMPriorityHi = !EXRAM_YI_Player_OAMPriorityLo+$01

;-- 32-byte DMA queue for Yoshi sprite + star counter graphics (8 entries x 4 bytes).
!EXRAM_YI_Player_GfxDMAQueue #= $000128|!SRAMBankBaseAddress

;-- Transformation state ($0000 = not transforming).
!EXRAM_YI_Player_TransformingStateLo #= $00014E|!SRAMBankBaseAddress
!EXRAM_YI_Player_TransformingStateHi = !EXRAM_YI_Player_TransformingStateLo+$01

;-- Mouth state ($00 idle, $01-$04 tongue extending/retracting, $07+ swallowing).
!EXRAM_YI_Player_MouthStateLo #= $000150|!SRAMBankBaseAddress
!EXRAM_YI_Player_MouthStateHi = !EXRAM_YI_Player_MouthStateLo+$01
;-- Tongue length (X) / height (Y) in pixels.
!EXRAM_YI_Player_TongueXLengthLo #= $000152|!SRAMBankBaseAddress
!EXRAM_YI_Player_TongueXLengthHi = !EXRAM_YI_Player_TongueXLengthLo+$01
!EXRAM_YI_Player_TongueYLengthLo #= $000154|!SRAMBankBaseAddress
!EXRAM_YI_Player_TongueYLengthHi = !EXRAM_YI_Player_TongueYLengthLo+$01
;-- Tongue position camera-relative ($0156/$0158) and absolute ($015A/$015C).
!EXRAM_YI_Player_TongueXPosRelLo #= $000156|!SRAMBankBaseAddress
!EXRAM_YI_Player_TongueXPosRelHi = !EXRAM_YI_Player_TongueXPosRelLo+$01
!EXRAM_YI_Player_TongueYPosRelLo #= $000158|!SRAMBankBaseAddress
!EXRAM_YI_Player_TongueYPosRelHi = !EXRAM_YI_Player_TongueYPosRelLo+$01
!EXRAM_YI_Player_TongueXPosLo #= $00015A|!SRAMBankBaseAddress
!EXRAM_YI_Player_TongueXPosHi = !EXRAM_YI_Player_TongueXPosLo+$01
!EXRAM_YI_Player_TongueYPosLo #= $00015C|!SRAMBankBaseAddress
!EXRAM_YI_Player_TongueYPosHi = !EXRAM_YI_Player_TongueYPosLo+$01
;-- Blocked-tongue state ($00..$0F) when tonguing walls.
!EXRAM_YI_Player_BlockedTongueStateLo #= $00015E|!SRAMBankBaseAddress
!EXRAM_YI_Player_BlockedTongueStateHi = !EXRAM_YI_Player_BlockedTongueStateLo+$01
;-- Inedible-tongue state for piranhas/chomp rocks, $0014 -> $0002 then $0.
!EXRAM_YI_Player_InedibleTongueStateLo #= $000160|!SRAMBankBaseAddress
!EXRAM_YI_Player_InedibleTongueStateHi = !EXRAM_YI_Player_InedibleTongueStateLo+$01
;-- Slot value of caught sprite (cleared immediately if inedible).
!EXRAM_YI_Player_TonguedSpriteSlotLo #= $000162|!SRAMBankBaseAddress
!EXRAM_YI_Player_TonguedSpriteSlotHi = !EXRAM_YI_Player_TonguedSpriteSlotLo+$01
;-- Sprite slot (+1) currently being tongued; sign bit set = cannot swallow.
!EXRAM_YI_Player_InMouthSpriteSlotLo #= $000168|!SRAMBankBaseAddress
!EXRAM_YI_Player_InMouthSpriteSlotHi = !EXRAM_YI_Player_InMouthSpriteSlotLo+$01

!EXRAM_YI_Level_Player_AmmoTypeInMouthLo #= $00016A|!SRAMBankBaseAddress
!EXRAM_YI_Level_Player_AmmoTypeInMouthHi = !EXRAM_YI_Level_Player_AmmoTypeInMouthLo+$01

;-- Spit-projectile duration timer (caps depend on ammo type: $08/$2A/$38/$18).
!EXRAM_YI_Player_SpitTimerLo #= $00016C|!SRAMBankBaseAddress
!EXRAM_YI_Player_SpitTimerHi = !EXRAM_YI_Player_SpitTimerLo+$01
;-- Watermelon-tongue intentional-freeze timer.
!EXRAM_YI_Player_WatermelonFreezeTimerLo #= $00016E|!SRAMBankBaseAddress
!EXRAM_YI_Player_WatermelonFreezeTimerHi = !EXRAM_YI_Player_WatermelonFreezeTimerLo+$01
;-- Ammo count remaining in mouth.
!EXRAM_YI_Player_AmmoCountInMouthLo #= $000170|!SRAMBankBaseAddress
!EXRAM_YI_Player_AmmoCountInMouthHi = !EXRAM_YI_Player_AmmoCountInMouthLo+$01
;-- Spit-X position (ice/fire melon) or rapid-seed counter (watermelon during Y-held).
!EXRAM_YI_Player_SpitXOrSeedCountLo #= $000172|!SRAMBankBaseAddress
!EXRAM_YI_Player_SpitXOrSeedCountHi = !EXRAM_YI_Player_SpitXOrSeedCountLo+$01
;-- Spit-Y position for ice/fire melons.
!EXRAM_YI_Player_SpitYPosLo #= $000174|!SRAMBankBaseAddress
!EXRAM_YI_Player_SpitYPosHi = !EXRAM_YI_Player_SpitYPosLo+$01

;-- Cutscene-injected controller mirrors: $17A/$17B = continuous, $17C/$17D = single-frame.
!EXRAM_YI_Global_CutsceneJoy1Lo #= $00017A|!SRAMBankBaseAddress
!EXRAM_YI_Global_CutsceneJoy1Hi #= $00017B|!SRAMBankBaseAddress
!EXRAM_YI_Global_CutsceneJoy1PressLo #= $00017C|!SRAMBankBaseAddress
!EXRAM_YI_Global_CutsceneJoy1PressHi #= $00017D|!SRAMBankBaseAddress

;-- Transform-form scratch words. Semantics vary by form (see SMWC notes):
;--   $17E = Car: left-wheel X / other: rotation angle (low byte only)
;--   $180 = Helicopter rotation speed, Submarine angle, Train size, Car X-pixel, SBM running-flag,
;--          Mole orientation, Ski-snowball state.
;--   $182 = Car right-wheel X / Helicopter anim frame.
;--   $184/$188 = Car left/right wheel Y.
;--   $198 = Car Y-pos / Super Baby Mario Y-scale (normalised at $0100).
!EXRAM_YI_Player_TransformScratch0Lo #= $00017E|!SRAMBankBaseAddress
!EXRAM_YI_Player_TransformScratch0Hi = !EXRAM_YI_Player_TransformScratch0Lo+$01
!EXRAM_YI_Player_TransformScratch1Lo #= $000180|!SRAMBankBaseAddress
!EXRAM_YI_Player_TransformScratch1Hi = !EXRAM_YI_Player_TransformScratch1Lo+$01
!EXRAM_YI_Player_TransformScratch2Lo #= $000182|!SRAMBankBaseAddress
!EXRAM_YI_Player_TransformScratch2Hi = !EXRAM_YI_Player_TransformScratch2Lo+$01
!EXRAM_YI_Player_TransformScratch3Lo #= $000184|!SRAMBankBaseAddress
!EXRAM_YI_Player_TransformScratch3Hi = !EXRAM_YI_Player_TransformScratch3Lo+$01
!EXRAM_YI_Player_TransformScratch4Lo #= $000188|!SRAMBankBaseAddress
!EXRAM_YI_Player_TransformScratch4Hi = !EXRAM_YI_Player_TransformScratch4Lo+$01
!EXRAM_YI_Player_TransformScratch5Lo #= $000198|!SRAMBankBaseAddress
!EXRAM_YI_Player_TransformScratch5Hi = !EXRAM_YI_Player_TransformScratch5Lo+$01

!EXRAM_YI_Level_FreezeYoshiFlagLo #= $0001AE|!SRAMBankBaseAddress
!EXRAM_YI_Level_FreezeYoshiFlagHi = !EXRAM_YI_Level_FreezeYoshiFlagLo+$01
!EXRAM_YI_Level_FreezeSpritesFlagLo #= $0001B0|!SRAMBankBaseAddress
!EXRAM_YI_Level_FreezeSpritesFlagHi = !EXRAM_YI_Level_FreezeSpritesFlagLo+$01

;-- Baby Mario state (set up like flags but mutually exclusive):
;--   $0000=floating crying, $2000=Super Baby/bonus, $4000=seized, $8000=riding Yoshi.
!EXRAM_YI_Player_BabyMarioStateLo #= $0001B2|!SRAMBankBaseAddress
!EXRAM_YI_Player_BabyMarioStateHi = !EXRAM_YI_Player_BabyMarioStateLo+$01
;-- $1B4 = on-platform-sprite flag (also count of platforms touched).
;-- $1B6 = slot # of the platform sprite being stood on (only set for moving platforms).
;-- $1B8 = previous-frame mirror of $1B4.
!EXRAM_YI_Player_OnPlatformFlagLo #= $0001B4|!SRAMBankBaseAddress
!EXRAM_YI_Player_OnPlatformFlagHi = !EXRAM_YI_Player_OnPlatformFlagLo+$01
!EXRAM_YI_Player_PlatformSpriteSlotLo #= $0001B6|!SRAMBankBaseAddress
!EXRAM_YI_Player_PlatformSpriteSlotHi = !EXRAM_YI_Player_PlatformSpriteSlotLo+$01
!EXRAM_YI_Player_OnPlatformFlagPrevLo #= $0001B8|!SRAMBankBaseAddress
!EXRAM_YI_Player_OnPlatformFlagPrevHi = !EXRAM_YI_Player_OnPlatformFlagPrevLo+$01

;-- Sprite-physics water line (used only for BG3 tilesets $13 / $1D). Format $ssyy.
;-- Left at $4000 when disabled. Does NOT affect regular water objects.
!EXRAM_YI_Level_SpriteWaterLineLo #= $0001BC|!SRAMBankBaseAddress
!EXRAM_YI_Level_SpriteWaterLineHi = !EXRAM_YI_Level_SpriteWaterLineLo+$01

;-- Camera Y-offset shake indices: $1C6 = small shake, $1C8 = large shake (timer + table index).
!EXRAM_YI_Level_SmallShakeTimerLo #= $0001C6|!SRAMBankBaseAddress
!EXRAM_YI_Level_SmallShakeTimerHi = !EXRAM_YI_Level_SmallShakeTimerLo+$01
!EXRAM_YI_Level_LargeShakeTimerLo #= $0001C8|!SRAMBankBaseAddress
!EXRAM_YI_Level_LargeShakeTimerHi = !EXRAM_YI_Level_LargeShakeTimerLo+$01

;-- Layer-1 Special Offset-By-Tile mode ($00 normal, $01 level mode 2, $03 fuzzied, $05 unused).
!EXRAM_YI_Level_SpecialOffsetModeLo #= $0001CA|!SRAMBankBaseAddress
!EXRAM_YI_Level_SpecialOffsetModeHi = !EXRAM_YI_Level_SpecialOffsetModeLo+$01

;-- Animation-pose timers ($1D0..$1E2).
!EXRAM_YI_Player_TurnPoseTimerLo #= $0001D0|!SRAMBankBaseAddress
!EXRAM_YI_Player_TurnPoseTimerHi = !EXRAM_YI_Player_TurnPoseTimerLo+$01
!EXRAM_YI_Player_WalkAnimTimerLo #= $0001D2|!SRAMBankBaseAddress
!EXRAM_YI_Player_WalkAnimTimerHi = !EXRAM_YI_Player_WalkAnimTimerLo+$01
!EXRAM_YI_Player_FallFlutterAnimTimerLo #= $0001D4|!SRAMBankBaseAddress
!EXRAM_YI_Player_FallFlutterAnimTimerHi = !EXRAM_YI_Player_FallFlutterAnimTimerLo+$01
!EXRAM_YI_Player_InvincibilityTimerLo #= $0001D6|!SRAMBankBaseAddress
!EXRAM_YI_Player_InvincibilityTimerHi = !EXRAM_YI_Player_InvincibilityTimerLo+$01
!EXRAM_YI_Player_IdleAnimTimerLo #= $0001D8|!SRAMBankBaseAddress
!EXRAM_YI_Player_IdleAnimTimerHi = !EXRAM_YI_Player_IdleAnimTimerLo+$01
!EXRAM_YI_Player_HeadBopAnimTimerLo #= $0001DC|!SRAMBankBaseAddress
!EXRAM_YI_Player_HeadBopAnimTimerHi = !EXRAM_YI_Player_HeadBopAnimTimerLo+$01
!EXRAM_YI_Player_GroundPoundAnimTimerLo #= $0001DE|!SRAMBankBaseAddress
!EXRAM_YI_Player_GroundPoundAnimTimerHi = !EXRAM_YI_Player_GroundPoundAnimTimerLo+$01
!EXRAM_YI_Player_MouthAnimTimerLo #= $0001E0|!SRAMBankBaseAddress
!EXRAM_YI_Player_MouthAnimTimerHi = !EXRAM_YI_Player_MouthAnimTimerLo+$01
!EXRAM_YI_Player_EggThrowStateTimerLo #= $0001E2|!SRAMBankBaseAddress
!EXRAM_YI_Player_EggThrowStateTimerHi = !EXRAM_YI_Player_EggThrowStateTimerLo+$01

;-- Mud/snow particle-spawn timer (initial $08, $00 = spawn if conditions met).
!EXRAM_YI_Level_MudSnowParticleTimerLo #= $0001EA|!SRAMBankBaseAddress
!EXRAM_YI_Level_MudSnowParticleTimerHi = !EXRAM_YI_Level_MudSnowParticleTimerLo+$01

;-- Auto-swallow timer for sprite in mouth ($04B0 -> $0).
!EXRAM_YI_Player_AutoSwallowTimerLo #= $0001EE|!SRAMBankBaseAddress
!EXRAM_YI_Player_AutoSwallowTimerHi = !EXRAM_YI_Player_AutoSwallowTimerLo+$01

;-- Transformation duration timer (counts down).
!EXRAM_YI_Player_TransformTimerLo #= $0001F4|!SRAMBankBaseAddress
!EXRAM_YI_Player_TransformTimerHi = !EXRAM_YI_Player_TransformTimerLo+$01
