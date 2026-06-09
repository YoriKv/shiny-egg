;#############################################################################################################
;# SRAM_Buffers.asm -- OAM buffer, OAM table mirrors, BG1 column/row tile buffers, spriteset state,
;#   sprite-data pointer, BG3 cross-section staging, newly-spawned-sprites table, stage-sprite
;#   spawn flags, sprite interactive terrain buffer, HDMA + window mask staging, message-box index,
;#   BG1 tile cache, OPT moving-object table, decompression buffer, free SRAM
;#   ($000200-$000EBF, $002600-$007BFF).
;#############################################################################################################

;-------------------------------------------------------------------------
; OAM buffer ($0200-$09FF) -- 256 entries x 4 words
;-------------------------------------------------------------------------
; First 16 OAM slots reserved for high-priority items (text etc.) so copy starts at $700A40
; for the low-table mirror / $700C30 for the high-table buffer.
;   Word 1: screen-relative X (low byte -> OAM low-table byte 1)
;   Word 2: screen-relative Y (low byte -> OAM low-table byte 2)
;   Word 3: copied into OAM low-table bytes 3 & 4 (tile + yxppccct)
;   Word 4: -p----sx------sx (priority, size, 9th X bit; low byte -> high-table buffer)
!EXRAM_YI_Global_OAMBuffer #= $000200|!SRAMBankBaseAddress

;-- Yoshi position on a spinning wooden platform, unaffected by rotation. These specific words
;-- are reused while the spinning-platform sprite owns the player frame; otherwise OAM-buffer
;-- payload.
!EXRAM_YI_Player_SpinPlatformSubXLo #= $000244|!SRAMBankBaseAddress
!EXRAM_YI_Player_SpinPlatformSubXHi = !EXRAM_YI_Player_SpinPlatformSubXLo+$01
!EXRAM_YI_Player_SpinPlatformXLo #= $000246|!SRAMBankBaseAddress
!EXRAM_YI_Player_SpinPlatformXHi = !EXRAM_YI_Player_SpinPlatformXLo+$01

;-------------------------------------------------------------------------
; OAM low-table mirror ($0A00-$0BFF, 512 B) -- 128 4-byte entries
;-------------------------------------------------------------------------
; Format: xxxxxxxx yyyyyyyy tttttttt yxppccct.
!EXRAM_YI_Global_OAMLowTableMirror #= $000A00|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; OAM high-table mirror ($0C00-$0C1F, 32 B) -- 2 bits per entry (msb-X + size)
;-------------------------------------------------------------------------
!EXRAM_YI_Global_OAMHighTableMirror #= $000C00|!SRAMBankBaseAddress
;-- OAM high-table buffer ($0C20-$0C9F, 128 B): one byte per OAM entry; low 2 bits shifted
;-- into the mirror at copy time.
!EXRAM_YI_Global_OAMHighTableBuffer #= $000C20|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Island angle ($0CA0) -- low byte only
;-------------------------------------------------------------------------
!EXRAM_YI_Global_IslandAngleLo #= $000CA0|!SRAMBankBaseAddress
!EXRAM_YI_Global_IslandAngleHi = !EXRAM_YI_Global_IslandAngleLo+$01

;-------------------------------------------------------------------------
; Screen ID table ($0CAA-$0D29, 128 B)
;-------------------------------------------------------------------------
; Maps raw screen # ($00-$7F) to screen ID ($00-$3F). Sign bit set = empty screen / camera-blocked
; / tile-erased (set by extended objects $FE / $FF).
!EXRAM_YI_Level_ScreenIDTable #= $000CAA|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; BG1 newly-spawned column / row tilemap buffers
;-------------------------------------------------------------------------
; $0DAA / $0DEA = column halves (64 B each, 32 SNES VRAM tilemap words; stride $40 between rows).
; $0E2A / $0E6E = row halves (68 B each, 34 words; two DMAs per half for tilemap 1 + 2).
!EXRAM_YI_Level_BG1ColumnLeftBuf #= $000DAA|!SRAMBankBaseAddress
!EXRAM_YI_Level_BG1ColumnRightBuf #= $000DEA|!SRAMBankBaseAddress
!EXRAM_YI_Level_BG1RowTopBuf #= $000E2A|!SRAMBankBaseAddress
!EXRAM_YI_Level_BG1RowBottomBuf #= $000E6E|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Spriteset file numbers ($0EB6-$0EBB) -- one byte per VRAM slot ($F7-$FC)
;-------------------------------------------------------------------------
!EXRAM_YI_Level_SpritesetFile1 #= $000EB6|!SRAMBankBaseAddress
!EXRAM_YI_Level_SpritesetFile2 #= $000EB7|!SRAMBankBaseAddress
!EXRAM_YI_Level_SpritesetFile3 #= $000EB8|!SRAMBankBaseAddress
!EXRAM_YI_Level_SpritesetFile4 #= $000EB9|!SRAMBankBaseAddress
!EXRAM_YI_Level_SpritesetFile5 #= $000EBA|!SRAMBankBaseAddress
!EXRAM_YI_Level_SpritesetFile6 #= $000EBB|!SRAMBankBaseAddress

;-- Previous-frame XY of sprite currently being processed (per-tick scratch).
!EXRAM_YI_Level_CurSpritePrevXLo #= $000EBC|!SRAMBankBaseAddress
!EXRAM_YI_Level_CurSpritePrevXHi = !EXRAM_YI_Level_CurSpritePrevXLo+$01
!EXRAM_YI_Level_CurSpritePrevYLo #= $000EBE|!SRAMBankBaseAddress
!EXRAM_YI_Level_CurSpritePrevYHi = !EXRAM_YI_Level_CurSpritePrevYLo+$01

;-------------------------------------------------------------------------
; Sprite-data pointer for current level ($2600)
;-------------------------------------------------------------------------
!EXRAM_YI_Level_SpriteDataPtrLo #= $002600|!SRAMBankBaseAddress
!EXRAM_YI_Level_SpriteDataPtrHi = !EXRAM_YI_Level_SpriteDataPtrLo+$01
!EXRAM_YI_Level_SpriteDataPtrBank = !EXRAM_YI_Level_SpriteDataPtrLo+$02

;-------------------------------------------------------------------------
; BG3 cross-section dynamic tile staging ($2604-$2683)
;-------------------------------------------------------------------------
; $2604..$2623: newly-spawned column of BG3 cross-section tiles, VRAM tilemap format
;               ($01CE = blank tile).
; $2624..$2643: mirror of $2604 column.
; $2644..$2683: newly-spawned row of BG3 cross-section tiles.
!EXRAM_YI_Level_CrossSectionNewColumn #= $002604|!SRAMBankBaseAddress
!EXRAM_YI_Level_CrossSectionColumnMirror #= $002624|!SRAMBankBaseAddress
!EXRAM_YI_Level_CrossSectionNewRow #= $002644|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Newly-spawned sprites this frame ($27CE)
;-------------------------------------------------------------------------
; Up to 31 8-byte entries + 4 bytes for an end marker (negative word-1 = end).
;   Word 1: Sprite ID  (copied to !EXRAM_YI_Level_NorSpr_SpriteID)
;   Word 2: X coordinate
;   Word 3: Y coordinate
;   Word 4: Stage ID / BG layer / sprite priority (copied to !EXRAM_YI_Level_NorSpr_StageID)
!EXRAM_YI_Level_NewlySpawnedSpritesTable #= $0027CE|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Stage-sprites spawning flags ($28CA)
;-------------------------------------------------------------------------
; 1 byte per stage ID ($00-$FF, same index as the StageID slot field).
;   $00 = not currently spawned, ready to spawn when its column/row scrolls in
;   $FF = do not spawn (currently active in a slot, or destroyed/swallowed)
!EXRAM_YI_Level_StageSpriteSpawnFlags #= $0028CA|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Sprite interactive terrain buffer ($29CA) -- mostly sand-breakers
;-------------------------------------------------------------------------
; $29CA: word pointer to next free entry within the $29CC table.
; $29CC..$2D6B: 5 entries (left/right/center/top/bottom) per sprite, 23 sprites + 1 spare,
;               8 bytes per entry: word X, word Y, word ?, word ?.
!EXRAM_YI_Level_SprTerrainBufferNextPtrLo #= $0029CA|!SRAMBankBaseAddress
!EXRAM_YI_Level_SprTerrainBufferNextPtrHi = !EXRAM_YI_Level_SprTerrainBufferNextPtrLo+$01
!EXRAM_YI_Level_SprTerrainBuffer #= $0029CC|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; HDMA BG scroll buffers ($3372 / $3516) -- staged here, DMA'd to $7E5040 / $7E51E4
;-------------------------------------------------------------------------
!EXRAM_YI_Level_HDMABGScrollBufferA #= $003372|!SRAMBankBaseAddress
!EXRAM_YI_Level_HDMABGScrollBufferB #= $003516|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Window mask staging ($3A02) -- registers $2126-$2129, copied to $7E56D0
;-------------------------------------------------------------------------
!EXRAM_YI_Level_WindowMaskBuffer #= $003A02|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Message-box index ($4070)
;-------------------------------------------------------------------------
!EXRAM_YI_Level_MessageBoxDataIndexLo #= $004070|!SRAMBankBaseAddress
!EXRAM_YI_Level_MessageBoxDataIndexHi = !EXRAM_YI_Level_MessageBoxDataIndexLo+$01

;-------------------------------------------------------------------------
; Currently-loaded BG1 foreground Map16 cache ($409E)
;-------------------------------------------------------------------------
; Table of Map16 indices covering the currently-loaded pair of BG1 foreground tiles
; (two screens side-by-side; even+odd X interleaved). Orientation tracks scroll.
!EXRAM_YI_Level_BG1ForegroundMap16Cache #= $00409E|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Offset-per-tile moving-object table ($449E)
;-------------------------------------------------------------------------
; 20 6-byte entries describing rectangles that oscillate up/down (6-4 platform style):
;   byte 1: left tile X (8-pixel tiles)
;   byte 2: top tile Y
;   byte 3: width-1
;   byte 4: height-1
;   byte 5: amplitude (signed; sign = initial direction)
;   byte 6: current offset
; When triggered, X is per-column, Y activates for the whole screen height.
!EXRAM_YI_Level_OPTMovingObjectTable #= $00449E|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Decompression / pixel-plot scratch buffer ($5800-$77FF, up to 8 KB)
;-------------------------------------------------------------------------
!EXRAM_YI_Global_SuperFXGFXBuffer #= $005800|!SRAMBankBaseAddress

;-------------------------------------------------------------------------
; Practically-free SRAM ($7800-$7BFF, 1 KB)
;-------------------------------------------------------------------------
; Only cleared on boot and during island-graphics scenes; safe scratch otherwise.
!EXRAM_YI_Global_FreeScratch1K #= $007800|!SRAMBankBaseAddress
