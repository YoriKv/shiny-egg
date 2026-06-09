;#############################################################################################################
;# SRAM_LevelState.asm -- Per-level dynamic state: egg inventory, dynamic blocks, camera state,
;#   autoscroll, OPT tables, BG1 wavy regions, cross-section state ($001DF6-$001FED).
;#############################################################################################################

;-------------------------------------------------------------------------
; Egg inventory ($1DF6) -- size in bytes + sprite indices
;-------------------------------------------------------------------------
; Size = (eggs+keys)*2 (each entry is a word). Indices point at the live sprite slot
; holding the egg/key on Yoshi's back.
!EXRAM_YI_Level_EggInventorySizeLo #= $001DF6|!SRAMBankBaseAddress
!EXRAM_YI_Level_EggInventorySizeHi = !EXRAM_YI_Level_EggInventorySizeLo+$01
!EXRAM_YI_Level_EggInventoryIndices #= $001DF8|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Player misc ($1E04..$1E06)
;-------------------------------------------------------------------------
!EXRAM_YI_Player_SuperBabyMarioTimerLo #= $001E04|!SRAMBankBaseAddress
!EXRAM_YI_Player_SuperBabyMarioTimerHi = !EXRAM_YI_Player_SuperBabyMarioTimerLo+$01
!EXRAM_YI_Level_ShowHiddenItemsFlag #= $001E06|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Dynamic-block bitflags ($1E08) -- Layer 1 tilemap toggles
;-------------------------------------------------------------------------
; $0008: !-switch blocks on
; $0010: Baby-Mario blocks on
!EXRAM_YI_Level_DynamicBlockFlagsLo #= $001E08|!SRAMBankBaseAddress
!EXRAM_YI_Level_DynamicBlockFlagsHi = !EXRAM_YI_Level_DynamicBlockFlagsLo+$01

;-------------------------------------------------------------------------
; Camera state ($1E0A..$1E2B)
;-------------------------------------------------------------------------
; $1E0A: 'Camera Y centers on Yoshi' flag.
; $1E0C: Camera X subpixel; $1E0D: Camera X pixels moved this frame.
; $1E0E: Camera Y subpixel; $1E0F: Camera Y pixels moved this frame.
; $1E10..$1E17: Previous-frame Yoshi sub/X and sub/Y position (4 words).
; $1E18/$1E1A: Min-left / Max-right camera X bounds (screen stoppers update these).
; $1E1C/$1E1E: Min-upper / Max-lower camera Y bounds.
; $1E20: Camera X window minimum (max = +24). $30 (Yoshi facing right) / $A8 (facing left).
; $1E22: Camera Y window minimum (max = +8). $10 top, $A0 bottom.
; $1E24: Up/down-button scroll counter; starts scrolling at $10.
; $1E26: X distance traveled by autoscroller, subpixel (high byte = spillage).
; $1E28: Current autoscroll X velocity (pixels + subpixels).
; $1E2A: Camera-event-active flag (stairs / flower vine / etc.) -- game is paused while non-zero.
!EXRAM_YI_Level_CameraYCentersOnYoshiLo #= $001E0A|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraYCentersOnYoshiHi = !EXRAM_YI_Level_CameraYCentersOnYoshiLo+$01
!EXRAM_YI_Level_CameraXSubpixel #= $001E0C|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraXPixelsMovedThisFrame #= $001E0D|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraYSubpixel #= $001E0E|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraYPixelsMovedThisFrame #= $001E0F|!SRAMBankBaseAddress
!EXRAM_YI_Player_PrevXSubpixelLo #= $001E10|!SRAMBankBaseAddress
!EXRAM_YI_Player_PrevXSubpixelHi = !EXRAM_YI_Player_PrevXSubpixelLo+$01
!EXRAM_YI_Player_PrevXPosLo #= $001E12|!SRAMBankBaseAddress
!EXRAM_YI_Player_PrevXPosHi = !EXRAM_YI_Player_PrevXPosLo+$01
!EXRAM_YI_Player_PrevYSubpixelLo #= $001E14|!SRAMBankBaseAddress
!EXRAM_YI_Player_PrevYSubpixelHi = !EXRAM_YI_Player_PrevYSubpixelLo+$01
!EXRAM_YI_Player_PrevYPosLo #= $001E16|!SRAMBankBaseAddress
!EXRAM_YI_Player_PrevYPosHi = !EXRAM_YI_Player_PrevYPosLo+$01
!EXRAM_YI_Level_CameraMinLeftXLo #= $001E18|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraMinLeftXHi = !EXRAM_YI_Level_CameraMinLeftXLo+$01
!EXRAM_YI_Level_CameraMaxRightXLo #= $001E1A|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraMaxRightXHi = !EXRAM_YI_Level_CameraMaxRightXLo+$01
!EXRAM_YI_Level_CameraMinUpYLo #= $001E1C|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraMinUpYHi = !EXRAM_YI_Level_CameraMinUpYLo+$01
!EXRAM_YI_Level_CameraMaxDownYLo #= $001E1E|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraMaxDownYHi = !EXRAM_YI_Level_CameraMaxDownYLo+$01
!EXRAM_YI_Level_CameraXWindowMinLo #= $001E20|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraXWindowMinHi = !EXRAM_YI_Level_CameraXWindowMinLo+$01
!EXRAM_YI_Level_CameraYWindowMinLo #= $001E22|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraYWindowMinHi = !EXRAM_YI_Level_CameraYWindowMinLo+$01
!EXRAM_YI_Level_UpDownScrollCounterLo #= $001E24|!SRAMBankBaseAddress
!EXRAM_YI_Level_UpDownScrollCounterHi = !EXRAM_YI_Level_UpDownScrollCounterLo+$01
!EXRAM_YI_Level_AutoScrollXTraveledLo #= $001E26|!SRAMBankBaseAddress
!EXRAM_YI_Level_AutoScrollXTraveledHi = !EXRAM_YI_Level_AutoScrollXTraveledLo+$01
!EXRAM_YI_Level_AutoScrollXVelocityLo #= $001E28|!SRAMBankBaseAddress
!EXRAM_YI_Level_AutoScrollXVelocityHi = !EXRAM_YI_Level_AutoScrollXVelocityLo+$01
!EXRAM_YI_Level_CameraEventActiveFlagLo #= $001E2A|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraEventActiveFlagHi = !EXRAM_YI_Level_CameraEventActiveFlagLo+$01

;-------------------------------------------------------------------------
; Camera-event Y speed ($1E38), 3D-plank slot ($1E3E), pseudo-3D platform state ($1E40-$1E43)
;-------------------------------------------------------------------------
!EXRAM_YI_Level_CameraEventYSpeedLo #= $001E38|!SRAMBankBaseAddress
!EXRAM_YI_Level_CameraEventYSpeedHi = !EXRAM_YI_Level_CameraEventYSpeedLo+$01
; Slot # +1 of spinning 3D plank sprite (ID $039) that Yoshi is standing on; $0000 if none.
!EXRAM_YI_Level_PlankStoodOnSlotLo #= $001E3E|!SRAMBankBaseAddress
!EXRAM_YI_Level_PlankStoodOnSlotHi = !EXRAM_YI_Level_PlankStoodOnSlotLo+$01
; Current angle/X for the pseudo-3D platform sprite being processed (falling walls, rolling logs).
!EXRAM_YI_Level_Pseudo3DPlatformAngleLo #= $001E40|!SRAMBankBaseAddress
!EXRAM_YI_Level_Pseudo3DPlatformAngleHi = !EXRAM_YI_Level_Pseudo3DPlatformAngleLo+$01
!EXRAM_YI_Level_Pseudo3DPlatformXPlus8Lo #= $001E42|!SRAMBankBaseAddress
!EXRAM_YI_Level_Pseudo3DPlatformXPlus8Hi = !EXRAM_YI_Level_Pseudo3DPlatformXPlus8Lo+$01

;-------------------------------------------------------------------------
; Baby Mario carry flag ($1E48), ambient sprite overwrite slot ($1E4A)
;-------------------------------------------------------------------------
; $0000 = on Yoshi's back, $FFFF = not.
!EXRAM_YI_Player_BabyMarioOnYoshiFlagLo #= $001E48|!SRAMBankBaseAddress
!EXRAM_YI_Player_BabyMarioOnYoshiFlagHi = !EXRAM_YI_Player_BabyMarioOnYoshiFlagLo+$01
; When all ambient slots are full, spawn at this slot - 4 (wraps to $003C if < 0).
!EXRAM_YI_Level_AmbSprOverwriteSlotLo #= $001E4A|!SRAMBankBaseAddress
!EXRAM_YI_Level_AmbSprOverwriteSlotHi = !EXRAM_YI_Level_AmbSprOverwriteSlotLo+$01

;-------------------------------------------------------------------------
; SuperFX dynamic-graphics chunk reservation ($1ECC / $1ECE)
;-------------------------------------------------------------------------
; $1ECC: bitmap of currently-reserved 16x16 chunks in the SuperFX dynamic gfx region
;        (VRAM $5C00-$5D00). Each nibble = a 32x32 piece, bits row-major:
;        %1234123412341234  1=top-left 2=top-right 3=bottom-left 4=bottom-right.
; $1ECE: 16 word-sized per-sprite masks (one per ambient slot in this 16-slot table)
;        showing which chunks each sprite has personally reserved. Indexed by the
;        sprite's dynamic-tile-index field (see Page 14 above).
!EXRAM_YI_Level_SuperFXChunksReservedLo #= $001ECC|!SRAMBankBaseAddress
!EXRAM_YI_Level_SuperFXChunksReservedHi = !EXRAM_YI_Level_SuperFXChunksReservedLo+$01
!EXRAM_YI_Level_SuperFXPerSpriteChunks #= $001ECE|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Offset-Per-Tile state ($1EEE-$1F71)
;-------------------------------------------------------------------------
; $1EEE: Camera X offset value during OPT mode (word).
; $1EF0: Camera Y offset value during OPT mode (word).
; $1EF2..$1F31: 32 word-sized X offsets per screen 8-pixel row (top->bottom).
; $1F32..$1F71: 32 word-sized Y offsets per screen 8-pixel column (left->right).
!EXRAM_YI_Level_OPTCameraXOffsetLo #= $001EEE|!SRAMBankBaseAddress
!EXRAM_YI_Level_OPTCameraXOffsetHi = !EXRAM_YI_Level_OPTCameraXOffsetLo+$01
!EXRAM_YI_Level_OPTCameraYOffsetLo #= $001EF0|!SRAMBankBaseAddress
!EXRAM_YI_Level_OPTCameraYOffsetHi = !EXRAM_YI_Level_OPTCameraYOffsetLo+$01
!EXRAM_YI_Level_OPTXOffsetTable #= $001EF2|!SRAMBankBaseAddress
!EXRAM_YI_Level_OPTYOffsetTable #= $001F32|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; BG1 wavy-effect rectangle table ($1F72-$1FC1)
;-------------------------------------------------------------------------
; 20 4-byte entries: byte1=left tile X, byte2=top tile Y, byte3=width-1, byte4=height-1.
; (All coords/sizes are 16-pixel tiles of the full stage.) When triggered, X is per-column
; but Y activates for the entire screen height.
!EXRAM_YI_Level_BG1WavyRectTable #= $001F72|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Misc level timers / cross-section state ($1FE8-$1FED)
;-------------------------------------------------------------------------
; $1FE8: Fuzzy dizzy effect timer (starts at $400).
; $1FEA: Cross-section state (entering/leaving phase machine, see SMW Central description).
; $1FEC: Inside-cross-section flag: $0000 not, $0002 inside.
!EXRAM_YI_Level_FuzzyEffectTimer #= $001FE8|!SRAMBankBaseAddress
!EXRAM_YI_Level_CrossSectionStateLo #= $001FEA|!SRAMBankBaseAddress
!EXRAM_YI_Level_CrossSectionStateHi = !EXRAM_YI_Level_CrossSectionStateLo+$01
!EXRAM_YI_Level_InsideCrossSectionFlagLo #= $001FEC|!SRAMBankBaseAddress
!EXRAM_YI_Level_InsideCrossSectionFlagHi = !EXRAM_YI_Level_InsideCrossSectionFlagLo+$01
