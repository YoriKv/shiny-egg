;#############################################################################################################
;# WRAM_Buffers.asm -- DMA queues, HDMA tables, tilemap mirrors, BG-gradient + screen-exit + Map16 buffers
;# ($7E4000-$7E79A5, $7EC000-$7EFFFF, $7F56DE-$7FFFFF).
;# See enginecore.md Sec. 2.2 (queue sentinels init) and Sec. 3 (per-frame DMA drain).
;#############################################################################################################

;-----------------------------------------------------------------------------
; Tilemap VRAM-DMA queue ($7E:4000-$7E:47FF). Drained every frame via
; process_tilemap_dma_queue. $7E:4000 = "bytes until next free entry"
; (queue head index). Sentinel $FFFF at $7E:4002 ends the queue at boot
; (see init_ram_sram in enginecore.md Sec. 2.2).
; Entries are variable-length; see TSV header for the bit layout.
;-----------------------------------------------------------------------------

!RAM_YI_Global_TilemapDMAQueueBytesUntilFree = $7E4000
!RAM_YI_Global_TilemapDMAQueueBuffer = $7E4002

;-----------------------------------------------------------------------------
; General-purpose VRAM-DMA queue ($7E:4800-$7E:503F). 12-byte entries
; (vram dest, vid ctrl, dma ctrl, dest reg, long src, size, next-entry ptr).
; $7E:4800 = address of last entry (queue tail); init_ram_sram seeds it to
; $4802 (the buffer's first slot).
;-----------------------------------------------------------------------------

!RAM_YI_Global_GeneralDMAQueueLastEntry = $7E4800
!RAM_YI_Global_GeneralDMAQueueBuffer = $7E4802

;-----------------------------------------------------------------------------
; HDMA tables, written every frame and DMA'd to the corresponding PPU
; scroll/window/colour registers ($7E:5040-$7E:5D97).
;-----------------------------------------------------------------------------

!RAM_YI_Global_HDMA_BG3VScrollTable = $7E5040			; 420 bytes; $2112 (BG2 $2110 when OPT)
!RAM_YI_Global_HDMA_BG3HScrollTable = $7E51E4			; 420 bytes; $2111 (BG2 $210F when OPT)
!RAM_YI_Global_HDMA_WindowTable = $7E56D0			; 840 bytes, 4 bytes/scanline; $2126-$2129

!RAM_YI_Global_HDMA_IndirectTable0 = $7E5A18			; 128 bytes; native SNES HDMA indirect format
!RAM_YI_Global_HDMA_IndirectTable1 = $7E5A98
!RAM_YI_Global_HDMA_IndirectTable2 = $7E5B18
!RAM_YI_Global_HDMA_IndirectTable3 = $7E5B98			; default Ch4: BG3 V-scroll (BG2 for OPT)
!RAM_YI_Global_HDMA_IndirectTable4 = $7E5C18			; common Ch3: BG3 H-scroll (BG2 for OPT)
!RAM_YI_Global_HDMA_IndirectTable5 = $7E5C98			; common Ch2: BG-gradient green & red
!RAM_YI_Global_HDMA_IndirectTable6 = $7E5D18			; common Ch1: BG-gradient blue

;-----------------------------------------------------------------------------
; Cross-level egg-inventory carry-over ($7E:5D98-$7E:5DA5).
;-----------------------------------------------------------------------------

!RAM_YI_Level_BetweenLevelEggInventoryBytesUsedLo = $7E5D98	; # of items * 2
!RAM_YI_Level_BetweenLevelEggInventoryBytesUsedHi = !RAM_YI_Level_BetweenLevelEggInventoryBytesUsedLo+$01
!RAM_YI_Level_BetweenLevelEggInventoryTable = $7E5D9A		; 6 words, each entry is a sprite ID

;-----------------------------------------------------------------------------
; Cross-section level mode (BG3 header $0A) tilemap mirrors ($7E:5DA6-$7E:79A5).
; Free RAM when not using cross-section mode.
;-----------------------------------------------------------------------------

!RAM_YI_Level_CrossSectionBG3GFXCopy = $7E5DA6			; 2048 bytes; copy of cross-section BG3 tile gfx, also Chomp Shark BG3 tilemap anims
!RAM_YI_Level_CrossSectionBG1TilemapLeftMirror = $7E65A6	; 2048 bytes; BG1 left tilemap mirror
!RAM_YI_Level_CrossSectionBG1TilemapRightMirror = $7E6DA6	; 1024 bytes; BG1 right tilemap mirror
!RAM_YI_Level_CrossSectionBG1TilemapOverlap = $7E71A6		; 1024 bytes; overlaps with both 2KB mirrors above
!RAM_YI_Level_CrossSectionBG3TilemapMirror = $7E75A6		; 1024 bytes; BG3 tilemap mirror (VRAM $3400)

;-----------------------------------------------------------------------------
; Code mirror of bank $00 routines ($7E:C000-$7E:FFFF), DMA'd at boot
; (enginecore.md Sec. 2.5). Symbolic per-routine pointers live in
; WRAM_RelocatedCode.asm.
;-----------------------------------------------------------------------------

!RAM_YI_Global_MainRAMCodeBlockMirror = $7EC000

;-----------------------------------------------------------------------------
; Title-screen GFX scratch buffer ($7F:56DE-).
;-----------------------------------------------------------------------------

!RAM_YI_TitleScreen_IslandDecorationGFXBuffer = $7F56DE

;-----------------------------------------------------------------------------
; Background-gradient colour tables ($7F:56DE-$7F:5BFF). Cover the entire
; sublevel top-to-bottom, every 8th X-pixel row. Written into HDMA indirect
; tables 5/6 each frame; the buffer at $7F:56DE overlaps with the
; TitleScreen scratch buffer above (different consumers at different times).
;-----------------------------------------------------------------------------

!RAM_YI_Level_BGGradientBlueTable = $7F56DE			; 438 bytes; $2132 COLDATA blue channel
!RAM_YI_Level_BGGradientGreenRedTable = $7F5894			; 876 bytes, 2 bytes/entry (green, red)

;-----------------------------------------------------------------------------
; Screen-exit table for current level ($7F:7E00-$7F:7FFF). 4 bytes per exit
; in screen-region order ($00-$7F):
;   level (00-DD), dest X, dest Y, entrance type (matches $7000AC Yoshi state).
;-----------------------------------------------------------------------------

!RAM_YI_Level_ScreenExitTable = $7F7E00

;-----------------------------------------------------------------------------
; Foreground MAP16 grid for the currently loaded sublevel ($7F:8000-$7F:FFFF).
; 32 KB total: screen-id then row-major tile #; entries are word-sized MAP16
; indices.
;-----------------------------------------------------------------------------

!RAM_YI_Level_LevelDataBuffer = $7F8000
