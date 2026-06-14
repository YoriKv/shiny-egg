;#############################################################################################################
;# SRAM_SpriteSlots.asm -- Sprite slot tables: ambient (16 slots) + regular (24 slots), $000EC0-$001DF8.
;#
;# Two interleaved slot arrays cover the per-frame sprite state. The layout is paged: each $A0-byte page
;# holds one ambient-sprite table ($40 bytes = 16 slots * 4 bytes) followed by one regular-sprite table
;# ($60 bytes = 24 slots * 4 bytes):
;#
;#     Page N base = $0EC0 + N*$A0
;#       +$00..+$3F : ambient table N (16 slots, 4 bytes/slot)
;#       +$40..+$9F : regular table N (24 slots, 4 bytes/slot)
;#
;# Total: 17 ambient tables ($0EC0..$1820) + 29 regular tables ($0F00..$1D96).
;# Source for the per-byte field decode below: brunovalads SRAM-Map wiki page, cross-verified against
;# behavior in the framework's sprite handlers.
;#
;# The GENERIC*Table* defines are kept verbatim for backwards-compat -- 100+ sites in Bank0[0-9] reference
;# them by their address-derived name. Descriptive defines (e.g. *_NorSpr_HitboxHalfWidthLo) alias the same
;# address and may be adopted in new code without breaking existing references.
;#
;# Cross-references:
;#   see also: yi/Constants/NormalSpriteIDs.asm   -- sprite ID -> handler-location pointers
;#   see also: yi/Constants/AmbientSpriteIDs.asm  -- ambient sprite ID list
;#   see also: docs/spritestateengine.md S4       -- the four per-sprite pointer tables
;#       (Init/Main/HeadBopped/RideYoshi) consumed by the slot fields below.
;#
;# SRAM map overview (this file documents the in-level sprite-slot tables; the surrounding
;# SRAM context is summarised here for navigation):
;#   $70:0000-006F  SuperFX scratch RAM (registers for ongoing GSU operations)
;#   $70:0070-0082  Controller inputs, sound-effect mirror, SFX queue, controller settings
;#   $70:008A-00F0  Yoshi position/velocity/state, layer camera positions, ground/jump state
;#   $70:00DE-0174  Egg/mouth/tongue/ammo state
;#   $70:00FA-0110  Terrain & collision flags
;#   $70:0104-01BC  Door/pipe/transition, transforms, Baby Mario state
;#   $70:01AE-01F4  Flags, timers (invincibility, idle, mouth, transformation, auto-swallow)
;#   $70:0200-09FF  OAM buffer (256 x 4-word entries)
;#   $70:0EB6       Spriteset state -- current file # for VRAM slots $F7-$FC (6 bytes)
;#   $70:0EC0-1DF8  *** SPRITE SLOTS (this file) *** 16 ambient + 24 regular slots, 4 bytes/slot/field
;#   $70:2000-21FF  CGRAM mirror (palette working copy)
;#   $70:2200-25FF  1/x lookup table for SuperFX division
;#   $70:5800-77FF  Decompressed file/graphics buffer (LZ output target)
;#   $70:7800-7BFF  Free SRAM (1 KB, cleared on boot and during island scenes)
;#   $70:7C00-7FFF  Save data (3 files x 104 bytes + 3 backup copies + 6-byte checksums)
;# Most of what an editor or debugger cares about for in-game state lives in SRAM, not WRAM
;# (a common source of confusion). The `!RAM_YI_*` defines that look like WRAM ($000118 etc.)
;# are WRAM via the bank-0 mirror; the ones with `|!SRAMBankBaseAddress` (= $700000 for SuperFX
;# mapping) live in cart RAM.
;#############################################################################################################

;-------------------------------------------------------------------------
; Page 1 ($0EC0 / $0F00) -- Status / state
;-------------------------------------------------------------------------
; Ambient: word 1 = existence flag (only low byte used). Word 2 unused.
; Regular: word 1 = sprite state. $0000 nonexistent, $0002 newly spawned, $0004 same?,
;          $0006 pop (turns into other sprite based on next table), $0008 in tongue/mouth,
;          $000A riding Yoshi, $000C colliding, $000E head-bop, $0010 active, $0012 burning.
;          Word 2 = angle of ground sprite is standing on.
!EXRAM_YI_Level_AmbSpr_SpriteExistsFlag #= $000EC0|!SRAMBankBaseAddress
!EXRAM_YI_Level_AmbSpr_UnusedRAM1 = !EXRAM_YI_Level_AmbSpr_SpriteExistsFlag+$02
!EXRAM_YI_Level_NorSpr_CurrentStatus #= $000F00|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_AngleOfStoodOnGround = !EXRAM_YI_Level_NorSpr_CurrentStatus+$02

;-------------------------------------------------------------------------
; Page 2 ($0F60 / $0FA0) -- Tongue / hitbox flags (regular); terrain flags (ambient)
;-------------------------------------------------------------------------
; Regular byte 1: tc?hhhhh  t=can-be-tongued, c=tongue-collision-ignored, h=hitbox-index
; Regular byte 2: unknown
; Regular byte 3: terrain collision flags
; Regular byte 4: ???s????  s=inedible / cannot-swallow
!EXRAM_YI_Level_NorSpr_TongueAndHitboxFlags #= $000FA0|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_TerrainCollisionFlags = !EXRAM_YI_Level_NorSpr_TongueAndHitboxFlags+$02
!EXRAM_YI_Level_NorSpr_InedibleFlag = !EXRAM_YI_Level_NorSpr_TongueAndHitboxFlags+$03

;-------------------------------------------------------------------------
; Page 3 ($1000 / $1040) -- Behavior + OAM flags (regular)
;-------------------------------------------------------------------------
; Regular byte 1: sf?bddmm  s=auto-swallow, f=can-be-frozen, b=can-be-burned,
;                           d=despawn-threshold-index ($00=no despawn), m=draw-method-index
; Regular byte 2: OAM bytes count (size in OAM buffer)
; Regular byte 3: partial OAM-low-table mirror: yx00ccc0  c=palette 0-7, x/y = flip
;                 Hot field: ~367 raw $7042 / $1042 sites across Bank01-11 + SuperFX banks.
!EXRAM_YI_Level_NorSpr_BehaviorFlags #= $001040|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_OAMByteCount = !EXRAM_YI_Level_NorSpr_BehaviorFlags+$01
!EXRAM_YI_Level_NorSpr_OAMFlipPaletteFlags = !EXRAM_YI_Level_NorSpr_BehaviorFlags+$02

;-------------------------------------------------------------------------
; Page 4 ($10A0 / $10E0) -- X position
;-------------------------------------------------------------------------
; Regular byte 1: sprite priority override flag ($40 = farthest back)
; Regular byte 2: X subpixel
; Regular byte 3: X pixel
; Regular byte 4: X screen
!EXRAM_YI_Level_NorSpr_PriorityOverride #= $0010E0|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_XSubpixel = !EXRAM_YI_Level_NorSpr_PriorityOverride+$01
!EXRAM_YI_Level_NorSpr_XPosLo #= $0010E2|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_XPosHi = !EXRAM_YI_Level_NorSpr_XPosLo+$01

;-------------------------------------------------------------------------
; Page 5 ($1140 / $1180) -- Y position
;-------------------------------------------------------------------------
; Regular byte 1: OBJ tile index override
; Regular byte 2: Y subpixel
; Regular byte 3: Y pixel
; Regular byte 4: Y screen
!EXRAM_YI_Level_NorSpr_OBJTileIndexOverride #= $001180|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_YSubpixel = !EXRAM_YI_Level_NorSpr_OBJTileIndexOverride+$01
!EXRAM_YI_Level_NorSpr_YPosLo #= $001182|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_YPosHi = !EXRAM_YI_Level_NorSpr_YPosLo+$01

;-------------------------------------------------------------------------
; Page 6 ($11E0 / $1220) -- Velocity (X word, Y word)
;-------------------------------------------------------------------------
!EXRAM_YI_Level_AmbSpr_XSpeedLo #= $0011E0|!SRAMBankBaseAddress
!EXRAM_YI_Level_AmbSpr_XSpeedHi = !EXRAM_YI_Level_AmbSpr_XSpeedLo+$01
!EXRAM_YI_Level_AmbSpr_YSpeedLo = !EXRAM_YI_Level_AmbSpr_XSpeedLo+$02
!EXRAM_YI_Level_AmbSpr_YSpeedHi = !EXRAM_YI_Level_AmbSpr_YSpeedLo+$01
!EXRAM_YI_Level_NorSpr_XSpeedLo #= $001220|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_XSpeedHi = !EXRAM_YI_Level_NorSpr_XSpeedLo+$01
!EXRAM_YI_Level_NorSpr_YSpeedLo = !EXRAM_YI_Level_NorSpr_XSpeedLo+$02
!EXRAM_YI_Level_NorSpr_YSpeedHi = !EXRAM_YI_Level_NorSpr_YSpeedLo+$01

;-------------------------------------------------------------------------
; Page 7 ($1280 / $12C0) -- Per-frame delta (currX - prevX, currY - prevY)
;-------------------------------------------------------------------------
!EXRAM_YI_Level_AmbSpr_XDeltaLo #= $001280|!SRAMBankBaseAddress
!EXRAM_YI_Level_AmbSpr_XDeltaHi = !EXRAM_YI_Level_AmbSpr_XDeltaLo+$01
!EXRAM_YI_Level_AmbSpr_YDeltaLo = !EXRAM_YI_Level_AmbSpr_XDeltaLo+$02
!EXRAM_YI_Level_AmbSpr_YDeltaHi = !EXRAM_YI_Level_AmbSpr_YDeltaLo+$01
!EXRAM_YI_Level_NorSpr_XDeltaLo #= $0012C0|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_XDeltaHi = !EXRAM_YI_Level_NorSpr_XDeltaLo+$01
!EXRAM_YI_Level_NorSpr_YDeltaLo = !EXRAM_YI_Level_NorSpr_XDeltaLo+$02
!EXRAM_YI_Level_NorSpr_YDeltaHi = !EXRAM_YI_Level_NorSpr_YDeltaLo+$01

;-------------------------------------------------------------------------
; Page 8 ($1320 / $1360) -- Sprite ID + OAM pointer
;-------------------------------------------------------------------------
; Word 1: sprite ID (NormalSpriteIDs.asm catalog)
; Word 2: pointer into OAM buffer for this sprite's first entry
!EXRAM_YI_Level_AmbSpr_SpriteID #= $001320|!SRAMBankBaseAddress
!EXRAM_YI_Level_AmbSpr_OAMIndex = !EXRAM_YI_Level_AmbSpr_SpriteID+$02
!EXRAM_YI_Level_NorSpr_SpriteID #= $001360|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_OAMIndex = !EXRAM_YI_Level_NorSpr_SpriteID+$02

;-------------------------------------------------------------------------
; Page 9 ($13C0 / $1400) -- Facing + animation frame
;-------------------------------------------------------------------------
; Word 1: facing/direction bitfield 00000yx0  y=Y flip (usually set by OAM mirror)  x=X flip
; Word 2: current animation frame (high byte = special flag for shyguys spat upward)
!EXRAM_YI_Level_AmbSpr_AnimFrame #= $0013C0|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_FacingFlags #= $001400|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_AnimFrame = !EXRAM_YI_Level_NorSpr_FacingFlags+$02

;-------------------------------------------------------------------------
; Page 10 ($1460 / $14A0) -- Stage-wide ID + layer + priority
;-------------------------------------------------------------------------
; Byte 1: stage-wide ID ($FF = no respawn)
; Byte 2: BG layer for this sprite
; Byte 3: sprite priority 0-7 (higher = further back, $FF disables drawing)
; Byte 4: unused
!EXRAM_YI_Level_NorSpr_StageID #= $0014A0|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_BGLayer = !EXRAM_YI_Level_NorSpr_StageID+$01
!EXRAM_YI_Level_NorSpr_DrawPriority = !EXRAM_YI_Level_NorSpr_StageID+$02

;-------------------------------------------------------------------------
; Page 11 ($1500 / $1540) -- Acceleration (X word, Y word) -- gravity / friction
;-------------------------------------------------------------------------
!EXRAM_YI_Level_AmbSpr_XAccelLo #= $001500|!SRAMBankBaseAddress
!EXRAM_YI_Level_AmbSpr_XAccelHi = !EXRAM_YI_Level_AmbSpr_XAccelLo+$01
!EXRAM_YI_Level_AmbSpr_YAccelLo = !EXRAM_YI_Level_AmbSpr_XAccelLo+$02
!EXRAM_YI_Level_AmbSpr_YAccelHi = !EXRAM_YI_Level_AmbSpr_YAccelLo+$01
!EXRAM_YI_Level_NorSpr_XAccelLo #= $001540|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_XAccelHi = !EXRAM_YI_Level_NorSpr_XAccelLo+$01
!EXRAM_YI_Level_NorSpr_YAccelLo = !EXRAM_YI_Level_NorSpr_XAccelLo+$02
!EXRAM_YI_Level_NorSpr_YAccelHi = !EXRAM_YI_Level_NorSpr_YAccelLo+$01

;-------------------------------------------------------------------------
; Page 12 ($15A0 / $15E0) -- Acceleration ceiling (max-speed cap)
;-------------------------------------------------------------------------
!EXRAM_YI_Level_AmbSpr_XAccelCeilLo #= $0015A0|!SRAMBankBaseAddress
!EXRAM_YI_Level_AmbSpr_XAccelCeilHi = !EXRAM_YI_Level_AmbSpr_XAccelCeilLo+$01
!EXRAM_YI_Level_AmbSpr_YAccelCeilLo = !EXRAM_YI_Level_AmbSpr_XAccelCeilLo+$02
!EXRAM_YI_Level_AmbSpr_YAccelCeilHi = !EXRAM_YI_Level_AmbSpr_YAccelCeilLo+$01
!EXRAM_YI_Level_NorSpr_XAccelCeilLo #= $0015E0|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_XAccelCeilHi = !EXRAM_YI_Level_NorSpr_XAccelCeilLo+$01
!EXRAM_YI_Level_NorSpr_YAccelCeilLo = !EXRAM_YI_Level_NorSpr_XAccelCeilLo+$02
!EXRAM_YI_Level_NorSpr_YAccelCeilHi = !EXRAM_YI_Level_NorSpr_YAccelCeilLo+$01

;-------------------------------------------------------------------------
; Page 13 ($1640 / $1680) -- Camera-relative position
;-------------------------------------------------------------------------
!EXRAM_YI_Level_AmbSpr_XRelativeCamLo #= $001640|!SRAMBankBaseAddress
!EXRAM_YI_Level_AmbSpr_XRelativeCamHi = !EXRAM_YI_Level_AmbSpr_XRelativeCamLo+$01
!EXRAM_YI_Level_AmbSpr_YRelativeCamLo = !EXRAM_YI_Level_AmbSpr_XRelativeCamLo+$02
!EXRAM_YI_Level_AmbSpr_YRelativeCamHi = !EXRAM_YI_Level_AmbSpr_YRelativeCamLo+$01
!EXRAM_YI_Level_NorSpr_XRelativeCamLo #= $001680|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_XRelativeCamHi = !EXRAM_YI_Level_NorSpr_XRelativeCamLo+$01
!EXRAM_YI_Level_NorSpr_YRelativeCamLo = !EXRAM_YI_Level_NorSpr_XRelativeCamLo+$02
!EXRAM_YI_Level_NorSpr_YRelativeCamHi = !EXRAM_YI_Level_NorSpr_YRelativeCamLo+$01

;-------------------------------------------------------------------------
; Page 14 ($16E0 / $1720) -- Vertical terrain collision offset + dynamic tile index
;-------------------------------------------------------------------------
; Word 1: vertical terrain collision offset in pixels (signed)
; Word 2: index into reserved dynamic tiles table (often SuperFX gfx; $FFFF = disabled)
!EXRAM_YI_Level_NorSpr_VertCollOffsetLo #= $001720|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_VertCollOffsetHi = !EXRAM_YI_Level_NorSpr_VertCollOffsetLo+$01
!EXRAM_YI_Level_NorSpr_DynTileIdxLo = !EXRAM_YI_Level_NorSpr_VertCollOffsetLo+$02
!EXRAM_YI_Level_NorSpr_DynTileIdxHi = !EXRAM_YI_Level_NorSpr_DynTileIdxLo+$01

;-------------------------------------------------------------------------
; Page 15 ($1780 / $17C0) -- Ambient: pause-active timer / Regular: Yoshi collision info
;-------------------------------------------------------------------------
; Regular byte 1: unknown
; Regular byte 2: timer (only one active during pause; commonly unused in game)
; Regular byte 3: Yoshi-relative X side: $00=Yoshi-to-left, $02=Yoshi-to-right
; Regular byte 4: Yoshi-relative Y side: $00=Yoshi-above, $02=Yoshi-below
!EXRAM_YI_Level_AmbSpr_TimerLo #= $001780|!SRAMBankBaseAddress
!EXRAM_YI_Level_AmbSpr_TimerHi = !EXRAM_YI_Level_AmbSpr_TimerLo+$01
!EXRAM_YI_Level_NorSpr_PauseActiveTimer #= $0017C1|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_YoshiXSide = !EXRAM_YI_Level_NorSpr_PauseActiveTimer+$01
!EXRAM_YI_Level_NorSpr_YoshiYSide = !EXRAM_YI_Level_NorSpr_PauseActiveTimer+$02

;-------------------------------------------------------------------------
; Page 16 ($1820 / $1860) -- Terrain collision flags + lava/water flags
;-------------------------------------------------------------------------
; Ambient byte 1: ???????G  G=on-ground flag
; Ambient byte 2: unknown
; Ambient byte 3: init $FF (unknown semantics)
; Ambient byte 4: init $1F (unknown semantics)
; Regular word 1: terrain LRUD flags (low byte: ????LRUD), high byte unused
; Regular word 2: lava/water flags (low byte: ??LW????)  L=lava, W=water
!EXRAM_YI_Level_AmbSpr_OnGroundFlag #= $001820|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_TerrainCollLRUD #= $001860|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_LavaWaterFlags = !EXRAM_YI_Level_NorSpr_TerrainCollLRUD+$02

;-------------------------------------------------------------------------
; Page 17 ($18C0 / $1900) -- Wildcard A (4 bytes/sprite, user-defined per handler)
;-------------------------------------------------------------------------
; Generic per-sprite scratch. Some handlers stash sprite-specific state here.
!EXRAM_YI_Level_AmbSpr_GenericTable7018C0 #= $0018C0|!SRAMBankBaseAddress
!EXRAM_YI_Level_AmbSpr_GenericTable7018C1 = !EXRAM_YI_Level_AmbSpr_GenericTable7018C0+$01
!EXRAM_YI_Level_AmbSpr_GenericTable7018C2 = !EXRAM_YI_Level_AmbSpr_GenericTable7018C0+$02
!EXRAM_YI_Level_AmbSpr_GenericTable7018C3 = !EXRAM_YI_Level_AmbSpr_GenericTable7018C0+$03
!EXRAM_YI_Level_NorSpr_GenericTable701900 #= $001900|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_GenericTable701901 = !EXRAM_YI_Level_NorSpr_GenericTable701900+$01
!EXRAM_YI_Level_NorSpr_GenericTable701902 = !EXRAM_YI_Level_NorSpr_GenericTable701900+$02
!EXRAM_YI_Level_NorSpr_GenericTable701903 = !EXRAM_YI_Level_NorSpr_GenericTable701900+$03

;-------------------------------------------------------------------------
; Global ($1970) -- RNG output + sprite-processing meta
;-------------------------------------------------------------------------
; $1970: RNG word; advanced each sprite each frame by adding PPU H/V scanline counters.
; $1972: slot # of sprite currently being processed (word).
; $1974: frame counter that only advances when sprites are being processed (game modes
;        $07, $0C (level fade-in only), $0E, $0F, $10 (in-level not score), $15, $39).
;        Drives tileset animation cycles.
!EXRAM_YI_Global_RNGOutputLo #= $001970|!SRAMBankBaseAddress
!EXRAM_YI_Global_RNGOutputHi = !EXRAM_YI_Global_RNGOutputLo+$01
!EXRAM_YI_Global_CurrentSpriteSlotLo #= $001972|!SRAMBankBaseAddress
!EXRAM_YI_Global_CurrentSpriteSlotHi = !EXRAM_YI_Global_CurrentSpriteSlotLo+$01
!EXRAM_YI_Global_SpriteFrameCounterLo #= $001974|!SRAMBankBaseAddress
!EXRAM_YI_Global_SpriteFrameCounterHi = !EXRAM_YI_Global_SpriteFrameCounterLo+$01

;-------------------------------------------------------------------------
; Page 18 ($1976) -- Wildcard B (regular only; commonly AI / graphical state)
;-------------------------------------------------------------------------
; 4 bytes per sprite. Many handlers use this for animation cycle state, AI sub-state,
; or rendering helpers. Per-sprite semantics vary; check each Init handler.
!EXRAM_YI_Level_NorSpr_GenericTable701976 #= $001976|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_GenericTable701977 = !EXRAM_YI_Level_NorSpr_GenericTable701976+$01
!EXRAM_YI_Level_NorSpr_GenericTable701978 = !EXRAM_YI_Level_NorSpr_GenericTable701976+$02
!EXRAM_YI_Level_NorSpr_GenericTable701979 = !EXRAM_YI_Level_NorSpr_GenericTable701976+$03

;-------------------------------------------------------------------------
; Page 19 ($19D6) -- Wildcard C (regular only; SuperFX-aware sprites use the byte 2/3 slots)
;-------------------------------------------------------------------------
; Common convention:
;   byte 1: AI state
;   byte 2: SuperFX graphic/animation-frame index
;   byte 3: 'next' animation frame
;   byte 4: per-sprite custom
!EXRAM_YI_Level_NorSpr_GenericTable7019D6 #= $0019D6|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_GenericTable7019D7 = !EXRAM_YI_Level_NorSpr_GenericTable7019D6+$01
!EXRAM_YI_Level_NorSpr_GenericTable7019D8 = !EXRAM_YI_Level_NorSpr_GenericTable7019D6+$02
!EXRAM_YI_Level_NorSpr_GenericTable7019D9 = !EXRAM_YI_Level_NorSpr_GenericTable7019D6+$03
!EXRAM_YI_NorSprXXX_PiranhaPlant_GrabbedYoshiFlag = !EXRAM_YI_Level_NorSpr_GenericTable701900

;-------------------------------------------------------------------------
; Page 20 ($1A36) -- SuperFX morphing values (regular only)
;-------------------------------------------------------------------------
; Used by SuperFX sprites for scale + rotation per frame. Format varies per-sprite.
!EXRAM_YI_Level_NorSpr_SuperFXMorph0 #= $001A36|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_SuperFXMorph1 = !EXRAM_YI_Level_NorSpr_SuperFXMorph0+$01
!EXRAM_YI_Level_NorSpr_SuperFXMorph2 = !EXRAM_YI_Level_NorSpr_SuperFXMorph0+$02
!EXRAM_YI_Level_NorSpr_SuperFXMorph3 = !EXRAM_YI_Level_NorSpr_SuperFXMorph0+$03

;-------------------------------------------------------------------------
; Page 21 ($1A96) -- Timer A (regular only; word-sized timers, 2 per slot)
;-------------------------------------------------------------------------
; Each word counts down. Commonly used for AI tick + skeletal animation tick.
!EXRAM_YI_Level_NorSpr_TimerALo #= $001A96|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_TimerAHi = !EXRAM_YI_Level_NorSpr_TimerALo+$01
!EXRAM_YI_Level_NorSpr_TimerBLo = !EXRAM_YI_Level_NorSpr_TimerALo+$02
!EXRAM_YI_Level_NorSpr_TimerBHi = !EXRAM_YI_Level_NorSpr_TimerALo+$03

;-------------------------------------------------------------------------
; Page 22 ($1AF6) -- Timer B (regular only; additional general-purpose word-sized timers)
;-------------------------------------------------------------------------
!EXRAM_YI_Level_NorSpr_TimerCLo #= $001AF6|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_TimerCHi = !EXRAM_YI_Level_NorSpr_TimerCLo+$01
!EXRAM_YI_Level_NorSpr_TimerDLo = !EXRAM_YI_Level_NorSpr_TimerCLo+$02
!EXRAM_YI_Level_NorSpr_TimerDHi = !EXRAM_YI_Level_NorSpr_TimerCLo+$03

;-------------------------------------------------------------------------
; Page 23 ($1B56) -- Hitbox center offset (X, Y)
;-------------------------------------------------------------------------
!EXRAM_YI_Level_NorSpr_HitboxXCenterOffsetLo #= $001B56|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_HitboxXCenterOffsetHi = !EXRAM_YI_Level_NorSpr_HitboxXCenterOffsetLo+$01
!EXRAM_YI_Level_NorSpr_HitboxYCenterOffsetLo = !EXRAM_YI_Level_NorSpr_HitboxXCenterOffsetLo+$02
!EXRAM_YI_Level_NorSpr_HitboxYCenterOffsetHi = !EXRAM_YI_Level_NorSpr_HitboxYCenterOffsetLo+$01

;-------------------------------------------------------------------------
; Page 24 ($1BB6) -- Hitbox half-extents from center (both sides)
;-------------------------------------------------------------------------
; Word 1: hitbox half-width (extends symmetrically)
; Word 2: hitbox half-height
!EXRAM_YI_Level_NorSpr_HitboxHalfWidthLo #= $001BB6|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_HitboxHalfWidthHi = !EXRAM_YI_Level_NorSpr_HitboxHalfWidthLo+$01
!EXRAM_YI_Level_NorSpr_HitboxHalfHeightLo = !EXRAM_YI_Level_NorSpr_HitboxHalfWidthLo+$02
!EXRAM_YI_Level_NorSpr_HitboxHalfHeightHi = !EXRAM_YI_Level_NorSpr_HitboxHalfHeightLo+$01

;-------------------------------------------------------------------------
; Page 25 ($1C16) -- Distance from Yoshi (X = positive when sprite is right of Yoshi)
;-------------------------------------------------------------------------
!EXRAM_YI_Level_NorSpr_XDistFromYoshiLo #= $001C16|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_XDistFromYoshiHi = !EXRAM_YI_Level_NorSpr_XDistFromYoshiLo+$01
!EXRAM_YI_Level_NorSpr_YDistFromYoshiLo = !EXRAM_YI_Level_NorSpr_XDistFromYoshiLo+$02
!EXRAM_YI_Level_NorSpr_YDistFromYoshiHi = !EXRAM_YI_Level_NorSpr_YDistFromYoshiLo+$01

;-------------------------------------------------------------------------
; Page 26 ($1C76) -- Collision delta from the sprite collided with
;-------------------------------------------------------------------------
; Word 1: X delta = thisX - thatX
; Word 2: Y delta = thisY - thatY
!EXRAM_YI_Level_NorSpr_CollXDeltaLo #= $001C76|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_CollXDeltaHi = !EXRAM_YI_Level_NorSpr_CollXDeltaLo+$01
!EXRAM_YI_Level_NorSpr_CollYDeltaLo = !EXRAM_YI_Level_NorSpr_CollXDeltaLo+$02
!EXRAM_YI_Level_NorSpr_CollYDeltaHi = !EXRAM_YI_Level_NorSpr_CollYDeltaLo+$01

;-------------------------------------------------------------------------
; Page 27 ($1CD6) -- Hitbox center absolute position (position + center offset from Page 23)
;-------------------------------------------------------------------------
!EXRAM_YI_Level_NorSpr_HitboxXCenterLo #= $001CD6|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_HitboxXCenterHi = !EXRAM_YI_Level_NorSpr_HitboxXCenterLo+$01
!EXRAM_YI_Level_NorSpr_HitboxYCenterLo = !EXRAM_YI_Level_NorSpr_HitboxXCenterLo+$02
!EXRAM_YI_Level_NorSpr_HitboxYCenterHi = !EXRAM_YI_Level_NorSpr_HitboxYCenterLo+$01

;-------------------------------------------------------------------------
; Page 28 ($1D36) -- Collision state
;-------------------------------------------------------------------------
; Byte 1: slot # of currently-colliding sprite + 1 ($FF for Yoshi)
; Byte 2: unknown -- something with the most-recent collision
; Byte 3: collision state:
;           $00 = may collide with Yoshi body/tongue/other sprites
;           $01 = may not collide with Yoshi body/other sprites but may be tongued
;           >$01 = cannot collide with anything; counts down until $01 enables tongue
; Byte 4: unknown -- used only for special purposes
!EXRAM_YI_Level_NorSpr_CurrentlyCollidingSlot #= $001D36|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_LastCollisionInfo = !EXRAM_YI_Level_NorSpr_CurrentlyCollidingSlot+$01
!EXRAM_YI_Level_NorSpr_CollisionState = !EXRAM_YI_Level_NorSpr_CurrentlyCollidingSlot+$02

;-------------------------------------------------------------------------
; Page 29 ($1D96) -- Frozen-from-ice-melon timer (regular only)
;-------------------------------------------------------------------------
; Word 1: counts down while sprite is frozen by an ice-melon hit
; Word 2: unused (most likely)
!EXRAM_YI_Level_NorSpr_FrozenTimerLo #= $001D96|!SRAMBankBaseAddress
!EXRAM_YI_Level_NorSpr_FrozenTimerHi = !EXRAM_YI_Level_NorSpr_FrozenTimerLo+$01
;---------------------------------------------------------------------------
