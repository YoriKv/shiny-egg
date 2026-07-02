# YI engine-core reference

A standalone reference for the Yoshi's Island Bank `$00` engine-core code:
how the SNES boots into the game, how interrupts route, how each
"per-frame and per-scene" service (palette load, gfx load, SPC upload,
DMA queues, tile animation, fade modes) is structured. Covers the
firmware-critical paths that live in Bank `$00` (and the WRAM-resident
mirror `$7E:C000+` block populated at boot).

This doc complements `docs/leveldataengine.md` (Bank10-13 level-data
parsing), `docs/levelloader.md` (gamemode chain that loads a level), and
`docs/mchip.md` (the SuperFX program). Together they cover the major
engine subsystems.

Source of truth: framework asm at `yi/Banks/Bank00.asm`.
Verified against `yoshisisland-disassembly/disassembly/bank00.asm`.

---

## 1. Bank `$00` map at a glance

```
$00:8000  yi_reset                 -- cold-boot entry
$00:80F1  GameLoop                 -- main loop (wait-VBlank + run gamemode)
$00:813F  YI_ROMHeaderVectorRAMCodeBlock  -- 16-byte stub copied to $7E:0100
$00:8150  run_current_gamemode     -- 69-entry game mode dispatcher
$00:816A  game_mode_pointers       -- 69 x 3-byte ptr-1 entries
$00:8239  disable_nmi / enable_nmi
$00:824B  init_oam / init_oam_buffer / oam_high_buffer_to_table
$00:8277  init_oam_and_bg3_tilemap
$00:8288  dma_wram_gen_purpose
$00:82AB  dma_init_gen_purpose     -- M7-multiplier fill trick
$00:82D0  init_ram_sram            -- boot-time WRAM/SRAM clear
$00:831C  clear_basic_states       -- level-entry partial RAM clear
$00:8365  execute_ptr              -- inline-table dispatch (16-bit)
$00:8380  execute_ptr_long         -- inline-table dispatch (24-bit)
$00:83A8  gm1e_start_select_level_fade
$00:83CD  gm_fade_screen_in_out    -- generic fade-step game mode
$00:83F0  gm_fade_alt              -- 1/3-speed fade
$00:83FC  gm16_world_end_cutscene_load -- 1/8-speed fade
$00:8408  random_number_gen        -- H-counter-fed PRNG (16-bit)
$00:841F  SPC700Upload             -- IPL-style SPC data upload
$00:84AC  SPC_ptr                  -- 20 SPC data block source ptrs
$00:84E8  spc_data_blocks          -- 14 rows of 4-byte block-set
$00:851C  item_denial_table        -- per-music-track item-pause flag
$00:852E  spc_block_set_indexes    -- per-music-ID -> spc_data_blocks row
$00:8543  set_level_music / upload_music_data
$00:85D2  push_sound_queue
$00:89CC  ambient_sprite_routines  -- 120-entry handler table
$00:8AB6  handle_ambient_sprites   -- per-frame sprite tick
$00:8AD7  execute_ambient_sprite_routine
$00:8AE5  check_ambient_sprite_freeze
$00:8B21  spawn_ambient_sprite
$00:8C12  ambient sprite physics (shared inner) + many ambient_* routines
$00:AD0A  ambient sprite render flush
$00:AD6D  scene_gfx_layout         -- variable-length scene gfx programs
$00:AF39  bg1_tileset_files / bg1_dark_tileset_files / bg2/bg3 / spriteset
$00:B339  load_level_gfx           -- the gfx loader master
$00:B39E  load_compressed_gfx_files -- inner loop
$00:B3CF  load_overworld_gfx
$00:B3EE  load_compressed_gfx_files_l
$00:B439  load_world_map_gfx
$00:B49E  load_per_world_variant_gfx
$00:B4D3  load_levelmode_0A_gfx
$00:B507  decompress_gfx_file      -- LZ16 / LZ2 dispatch
$00:B54D  decompress_lc_lz2
$00:B582  inner DMA-to-VRAM staging
$00:B78A  scene_palette_layout     -- variable-length palette programs
$00:B874  bg1_palette_ptrs / bg1_dark / bg2 / bg3 / sprite / yoshi
$00:BA24  load_level_palettes
$00:BA7A  load_palettes            -- the palette interpreter
$00:BB47  load_world_map_palettes
$00:BB70  load_yoshi_color_palette
$00:BB90  load_levelmode_0A_palettes
$00:BBAF  scene_layout_indices     -- mode-id -> scene_register_layout offset
$00:BBDB  reg_mirror_mapping       -- which $21xx for each mirror slot
$00:BBEA  scene_register_layout    -- 22 x 20-byte scene-mode tables
$00:BDA2  init_scene_regs          -- PPU/SuperFX scene setup
$00:BE26  copy_division_lookup_to_sram
$00:BE39  queue_dma_4args / $00:BE71 queue_dma_3args_plus_a
$00:BEA6+ vram_dma_queue_add_* (6 near-identical helpers)

------ START of !RAM_YI_Global_MainRAMCodeBlock (relocated to $7E:C000) ------
$00:C000  YI_VBlankRt              -- NMI handler
$00:C024  play_music_track / handle_sound
$00:C074  interrupt_mode_nmi_handlers (8-entry dispatch)
$00:C084  nmi_normal_level
$00:C10A  nmi_null
$00:C10B  nmi_world_map_cutscene
$00:C22C  nmi_bonus_raphael_mode7
$00:C3E8  YI_IRQRt / IRQ_Handler / IRQ_Start
$00:C40A  irq_kind (4-entry dispatch)
$00:C412  irq_default + irq_0 + next_irq + set_v_irq + set_v_irq_return
$00:C465  irq_2 + irq_vram_tx_routines (8-entry)
$00:C48D  irq_normal_level_mode
$00:C5FE  irq_offset_per_tile_levels
$00:C641  irq_raphael_the_raven_boss
$00:C714  level_intro_irq_routines + helpers
$00:C821  irq_story_cutscene
$00:C87A  irq_story_cutscene_credits
$00:CA9A  irq_credits
$00:D308  irq_bonus_game
$00:D571  init_tileset_animation
$00:D59D  default_tile_anim_vram_ptrs / DATA_00D5DD / DATA_00D61D
$00:D65D  animate_bg_tilesets
$00:D6C2  tile_animation_ptrs (18 entries)
$00:D6E6+ tile_animation_00..11 per-header handlers
$00:DBA9+ BG3 tilemap stitch helpers (CODE_00DBA9, CODE_00DC6B, CODE_00DC97)
$00:DCAE  BG1 tile-stamp finaliser
$00:DE0C  multi-DMA queue processor
$00:DE44  YI_BeginSuperFXProcessingRt = gsu_init_1
$00:DE67  gsu_init_2
$00:DE91  gsu_init_3
$00:DECF  gsu_init_4 (with stop-code dispatch)
$00:DF28  gsu_stop_code_dispatch (14 entries, R0 yield codes)
$00:E152  gsu_init_5 (tilemap-stitch)
$00:E372  push_sound_queue_pres_x
$00:E37B  prepare_tilemap_dma_queue_l
$00:E383  tilemap_dma_queue_pointers (13 entries)
$00:E3AA  prepare_tilemap_dma_queue
$00:E3CE  vram_dma_queue_pointers (3 entries)
$00:E3D7  process_vram_dma_queue_l
$00:E3DF  process_vram_dma_queue
$00:E44A  process_tilemap_dma_queue
$00:E507  spin-then-update_controllers
$00:E552  div_onebyx_lut (1024 bytes)
$00:E954  cosine_lut_8bit_radians (64 entries)
$00:E9D4  sine_lut_8bit_radians (256 entries)
$00:EBD4+ per-level data blobs (incbin LevelData/DATA_00*.bin)
```

---

## 2. Reset + boot sequence

Cold-boot enters at `yi_reset` (CODE_008000), JML'd from the ROM header
reset vector at `$00:FFFC`. This is the firmware-critical path: any byte
change here can brick the boot.

### 2.1 Phase 1 -- CPU + PPU bring-up (all under SEI)

1. `XCE` to native mode, `REP #$09` then `XCE` selects 65816 native mode.
2. Set DBR := `$00`, D := `$0000`, stack at `$01FF`.
3. Mask NMI/IRQ/auto-joypad (`$4200 = 0`), force PPU into f-blank with
   max brightness (`$2100 = $8F`), clear APU ports 0-3, latch H/V
   counters to zero, enable SuperFX BRAM writes (`$3030 = $01`).
4. Disable DMA enables (`$420B = $420C = 0`), disable FastROM (`$420D = 0`).
5. Set OAM address to `$8000`, stack to `$01FF`.

### 2.2 Phase 2 -- RAM/SRAM zero (JSL CODE_0082D0)

`init_ram_sram` (CODE_0082D0) walks five WRAM/SRAM regions via
`dma_init_gen_purpose`:

| Range | Notes |
|---|---|
| `$7E:0000-$7E:00FF` | direct page |
| `$7E:0200-$7E:BFFF` | WRAM body (not the relocated-code area at $C000+) |
| `$7F:0000-$7F:FFFF` | ExRAM (full 64 KB) |
| `$70:0000-$70:7BFF` | SRAM (excluding save-data tail at `$70:7C00+`) |

Then writes sentinels: `$7E:4002 = $FFFF` (end of tilemap-DMA queue),
`$7E:4800 = $4802` (end of VRAM-DMA queue).

The fill trick: `dma_init_gen_purpose` puts the desired byte into M7A
($211B) low byte, M7B ($211C) high byte = `0`, M7B = `1`, then DMAs from
`$2134` (M7 multiplication result low) -- since M7 result = A * B + (X<<8)
this produces a constant byte stream the same value as A_low.

### 2.3 Phase 3 -- SPC engine upload (JSL CODE_008543 with X=$10)

`set_level_music` stores X into the music-setting byte, then re-reads it and
`INX`es before indexing -- so X=$10 selects spc_block_set_indexes[$11] = `$00`,
which from `spc_data_blocks` points at row 0 = `$2B, $FF, $FF, $FF`: a single
block `$2B`, resolved by `SPC_ptr[14]` to `YI_SPCEngine` (block-set "engine
only" -- the SPC driver program with no song/sample data, exactly what a reset
wants). (Block-set `$25,$19,$1F` quoted in older notes is for music-settings
$07-$09, not reset.) The new blocks are diffed against
the currently-resident blocks at $0207..$020A; the resulting source
pointers (3-byte each, looked up via SPC_ptr) get stuffed into DP $00..$0B
and SEI-bracketed `SPC700Upload` runs the IPL-style handshake.

`SPC700Upload`'s handshake:
1. Wait until APU port 0 reads `$BBAA` (SPC IPL ready).
2. Send `$CC` and the first block's address+size to APU ports 0-3.
3. For each block, transfer 2 bytes/iter (interleaved low/high in A);
   confirm validation-byte advance per send.
4. Each block ends with a zero-size word that tells SPC to "start
   executing" -- the SPC engine then runs forever, polling APU port 0
   for music IDs and APU port 3 for sound-FX IDs.

**Block-set residency is path-dependent -- the resident mirror is NOT a
snapshot of ARAM.** `$0207..$020A` track only the *last* upload's block IDs, but
each block uploads to a fixed, non-overlapping ARAM region and an `$FF` slot
means "keep whatever's already there" -- so physical ARAM is the *accumulation*
of every block set loaded along the player's route, not just the current set. A
block loaded once persists into later levels whose own sets don't reuse its
slot. The consequence bit real code: the bonus/defeat theme (music `$07`) -- and
the goal-ring fanfare -- live in block `$1C` (`SPC_ptr[9]` = `DATA_4F4122`; PC
`$0F4122` = LoROM `$1E:C122`), which is uploaded by **exactly one** block set:
row 2 `$25,$22,$1C`, reached **only** by music-setting `$12` (the overworld). So
it is resident in every level reached *from the map* -- but reaching a level
WITHOUT the overworld (a cold warp or level-jump that re-inits the SPC and skips
the map) leaves block `$1C` absent, and requesting song `$07` then **hangs the
SPC driver** (no voice ever keys on; the prior song's buffer just repeats). A
"warm" in-session warp is unaffected -- the block is still resident from the
earlier map visit. Diagnosed via runtime SPC700 tracing; full write-up in
`trace-harness/scenarios/spike-audio/PLAN.md`. (The cbrgray YI practice hack hit
the same hole when warping in before the map loads, and confirms only block `$1C`
is needed: it pre-uploads that one block on first level entry as its fix.)

The missing-block hang is one instance of a general weakness: **the SPC driver
has no defense against missing or zero-initialized state.** Two further
driver-wedge modes are *reported by the cbrgray practice hack* and noted here as
leads -- they have **not** been independently re-verified against our ROM
(neither touchpoint shows up under static analysis, so confirming them needs an
SPC700 trace): (1) a music change issued while the WRAM-stored song tempo
($03CF) is still zero -- e.g. if music is suppressed from boot so the tempo
field is never primed -- is said to upload a zero tempo and spin the driver in a
loop; the hack works around it by sending one APU-port-0 write on boot to prime
the tempo. (2) loading state or unpausing without re-poking the APU (port-2
mirror $0053) is said to leave the driver hung; the hack writes an "unpause"
value to re-enable. Both are consistent with the fragility above, but treat the
specific addresses as unconfirmed until traced.

### 2.4 Phase 4 -- interrupt trampoline DMA

The 16-byte block at `YI_ROMHeaderVectorRAMCodeBlock` ($00:813F) is
DMA'd into `$7E:0100-$7E:010F` via a simple read-back loop (not
dma_wram_gen_purpose, because it would race with itself before DMA is
ready).

Layout of the relocated block:
```
$7E:0100  RTI + 3 NOPs           ; COP / unused
$7E:0104  RTI + 3 NOPs           ; BRK / unused
$7E:0108  JML !RAM_YI_Global_VBlankRt  ; NMI lands here (via $00:FFEA)
$7E:010C  JML !RAM_YI_Global_IRQRt     ; IRQ lands here (via $00:FFEE)
```

The ROM header `$00:FFEA` (native NMI vector) and `$00:FFEE` (native IRQ
vector) are programmed to `$0108` and `$010C` respectively -- so all
interrupts hit RAM trampolines that JML into the live VBlank/IRQ
routines. This is what lets late patches override NMI/IRQ without
re-flashing the cart-header vectors.

### 2.5 Phase 5 -- main RAM code block DMA

The 16 KB block from `YI_MainRAMCodeBlock` (= `$00:C000`) to
`ROMBANK00_END` ($00:F7A6) is DMA'd to WRAM starting at
`!RAM_YI_Global_MainRAMCodeBlock` (= `$7E:C000`). This includes
EVERYTHING from the NMI handler onward (NMI, music handler, all IRQ
handlers, gsu_init_*, tilemap queue processors, etc).

After the DMA, the SuperFX RAMBR is initialised by JSL'ing
`FXCODE_08A97B` through `YI_BeginSuperFXProcessingRt`
(= `!RAM_YI_Global_BeginSuperFXProcessingRt`).

### 2.6 Phase 6 -- SRAM checksum + game-save regeneration

Two guard bytes at `$70:7E7C-$70:7E7D` are checked: if both are zero
AND the byte at `$70:7E7C` < `$03`, skip. Otherwise wipe SRAM
state-bytes at `$70:7E70..7E7B` (zeroed in 16-bit pairs) and call
`CODE_108000` (Bank10's save-file regeneration entry, which rewrites
the save header / wipes per-slot save data).

### 2.7 Phase 7 -- CLI and enter GameLoop

After CLI, the program falls through into `GameLoop`. The loop is:

```
loop:
  LDA $011B               ; frame-complete sentinel
  BMI loop                ; spin until interrupt clears the high bit
  ; (optional DEBUG frame-stepper block, controller-2)
  INC $30                 ; bump global frame counter
  JSL run_current_gamemode
  DEC $011B               ; mark "frame consumed"
  BRA loop
```

`$011B` is set positive by the NMI handler when a video frame completes;
the BMI loop spins until then, ensuring exactly one game-mode tick per
visible frame.

---

## 3. Game-mode dispatcher pipeline

The 65816 has 69 distinct "game modes" (numbered `$00..$44`). The state
machine that decides which screen / cutscene / level / fade is active
lives in `!RAM_YI_Global_CurrentGameMode` (a single byte at
`!RAM_YI_Global_CurrentGameMode` = `$0118`).

### 3.1 The dispatcher

`run_current_gamemode` (CODE_008150):

```asm
LDA !RAM_YI_Global_CurrentGameMode   ; current mode (0..68)
ASL                                  ; \ x3 (24-bit table stride)
ADC !RAM_YI_Global_CurrentGameMode   ; /
TAX
PHB                                  ; preserve caller DBR
LDA DATA_00816A+2,x                  ; bank byte of handler
PHA
PHA
PLB                                  ; DBR := handler's bank
LDA DATA_00816A+1,x                  ; address-1 high
PHA
LDA DATA_00816A,x                    ; address-1 low
PHA
RTL                                  ; RTL pops bank/hi/lo -> jump to handler
```

The handler's "address-1" convention is the standard 65816 trick: RTL
pops the 24-bit value + 1, so storing `addr-1` puts execution at `addr`.
Each handler RTLs back to the GameLoop.

### 3.2 game_mode_pointers (DATA_00816A)

69 entries, 3 bytes each. The full per-mode meaning table follows the
annotations at `yoshisisland-disassembly/disassembly/bank00.asm:198+`.
Selected highlights:

| Mode | Handler | Description |
|---|---|---|
| `$00` | `CODE_10838B` | Reset / soft start |
| `$01` | `CODE_10891E` | First-time boot, prepare title |
| `$0A` | `gm_fade_to_title_screen` | Fade into title |
| `$0C` | `gm0c_level_fadein_and_name` | Level intro (with level-name banner) |
| `$0D` | `gm0d_level_fadein_post_pipe_or_door` | Re-fade after pipe/door |
| `$0E` | `gm0e_level_fadein_to_control` | Final fade -> hand control to player |
| `$0F` | `CODE_01C0D9` | **In-level main tick** (the gameplay handler) |
| `$10` | `CODE_01B580` | Pause-menu logic |
| `$11` | `CODE_108E86` | Pause-menu draw |
| `$1E` | `gm1e_start_select_level_fade` | Start+Select fade-out (kill level) |
| `$20` | `CODE_10E1DA` | Prepare overworld scene |
| `$28` | `CODE_01E26D` | Bonus-game logic |
| `$31` | `gm31_fade_to_score_from_boss` | Score after boss |
| `$33` | `gm33_fade_to_midring_restart_screen` | Restart-from-middle-ring fade |

19 entries route to `gm_fade_screen_in_out` (CODE_0083CD); 5 entries
route to `gm_fade_alt` (CODE_0083F0); 1 each to `gm1e_*` and `gm16_*`.

### 3.3 Fade game modes

Three closely-related routines handle the visual fade between scenes:

| Routine | Speed | $0202 reload | Used by |
|---|---|---|---|
| `gm_fade_screen_in_out` (CODE_0083CD) | 1 step/frame | -- | 19 fades |
| `gm_fade_alt` (CODE_0083F0) | 1 step/3 frames | 2 | 5 fades |
| `gm16_world_end_cutscene_load` (CODE_0083FC) | 1 step/8 frames | 8 | 1 fade |

State at `$0200` = INIDISP brightness mirror (low nibble);
`$0201` = direction (0 = in, 1 = out). `fade_amount` (DATA_0083C4) = `$01, $FF`
indexed by `$0201`; `fade_limit` (DATA_0083C6) = `$0F, $00` likewise.

Each step:
- read brightness mirror, AND `$0F`
- compare to `fade_limit[$0201]`; if matched, toggle direction and
  `INC CurrentGameMode` to advance to the next mode
- else `ADC fade_amount[$0201]` and store back to mirror

The actual brightness write to PPU `$2100` happens in the next NMI
(handler reads `$0200` and writes it to INIDISP -- see
`nmi_normal_level` step 7).

---

## 4. NMI / IRQ flow

### 4.1 Interrupt vectors

All interrupts route through WRAM trampolines (see Phase 4 of reset
above). The ROM header at `$00:FFE0-$00:FFFF` programs:

| Vector | ROM addr | Target |
|---|---|---|
| Native NMI | `$00:FFEA` | `$7E:0108` (= JML to !RAM_YI_Global_VBlankRt) |
| Native IRQ | `$00:FFEE` | `$7E:010C` (= JML to !RAM_YI_Global_IRQRt) |
| Native COP/BRK | various | RTI (no-op) |
| Native ABORT | -- | unused (RTI) |

`!RAM_YI_Global_VBlankRt` resolves to `YI_VBlankRt` = `$7E:C000`
(relocated from ROM `$00:C000`). Same for IRQ.

### 4.2 NMI handler structure

`YI_VBlankRt` (CODE_00C000) runs once per video frame at the start of
VBlank:

```
SEI; push A/X/Y/D/B; D=$0000; M=8/X=8; DBR=$00
LDY $4210                              ; clear RDNMI latch
LDX $011C                              ; interrupt_mode (set by init_scene_regs)
JSR (interrupt_mode_nmi_handlers,X)    ; dispatch (8 entries, stride 2)
;  -- music + sound queue processing (play_music_track + handle_sound) --
;  -- restore regs, RTI --
```

The NMI dispatch (DATA_00C074 = `interrupt_mode_nmi_handlers`) has 8
entries indexed by `$011C`:

| `$011C` | Handler | What it does |
|---|---|---|
| `$00` | `nmi_normal_level` (CODE_00C084) | Main level mode: full per-frame DMA chain |
| `$02` | `nmi_null` (CODE_00C10A) | RTS only |
| `$04` | `nmi_null` | RTS only |
| `$06` | `nmi_bonus_raphael_mode7` (CODE_00C22C) | Mode-7 boss / bonus, DMA + M7 matrix |
| `$08` | `nmi_null` | RTS only |
| `$0A` | `nmi_null` | RTS only |
| `$0C` | `nmi_world_map_cutscene` (CODE_00C10B) | World map / story cutscene path |
| `$0E` | `nmi_null` | RTS only |

`$011C` is set by `init_scene_regs` from byte 0 of the current
scene_register_layout row (i.e. per-level-mode).

### 4.3 nmi_normal_level (the heaviest NMI path)

If `$011B` is non-zero (game-mode tick completed since last frame):

1. STZ `$011B` (signal "frame consumed").
2. `process_vram_dma_queue` -- drain the OAM/tile staging queue at
   `$7E:4800` (entries 12 bytes each; see section 6 below).
3. `prepare_tilemap_dma_queue` -- pick the active tilemap queue via
   `$0127` and process it.
4. `CODE_00D4AC` -- DMA `$0220` bytes from `$7E:6A00` to PPU OAM via DMA0.
5. `CODE_00D4E5` -- DMA the COLDATA mirror + CGRAM mirror (`$70:2000`,
   `$0200` bytes) to PPU `$2122` (CGRAM).
6. `CODE_00DC6B` -- copy BG3 tilemap stitching from staging to VRAM.
7. `update_controllers` -- spin-wait until auto-joypad-read finishes,
   read controllers 1+2, compute edge masks at `$093E`/`$0942`.
8. Copy `$30..$44` layer scroll mirrors to PPU `$210D-$2114` (BG1H,
   BG1V, BG2H, BG2V, BG3H, BG3V; written in 2-byte pairs because each
   register is high-then-low latched).
9. Restore INIDISP from `$0200` mirror; restore HDMA enable from
   `!RAM_YI_Global_HDMAEnable` mirror.

Steps 4-6 happen with INIDISP forced to `$8F` (full-blank max-brightness)
so the DMA doesn't tear with active rendering.

### 4.4 Music + sound (always-run NMI tail)

After the dispatched handler returns, the NMI always:

```
play_music_track:
  ; if $51 (PlayMusic) is non-zero AND APU port 0 == previous music ID:
  ;   STA $2140 (start new track); cache as previous; clear $51
handle_sound:
  ; if $51 (PlaySFX) is non-zero: STA $2141 (play SFX); clear $51
  ; sound-FX queue: shuffle queue down by 1 if APU port 3 ack'd previous
  ;   sound; post next sound from queue head; cap queue size to 6
```

This is the only ongoing data path from CPU to SPC; the SPC engine
itself reads the music/SFX IDs and renders audio independently. Sound
producers append via `push_sound_queue` (long callable, A = sound ID).

### 4.5 IRQ handler structure

YI uses scanline IRQ for per-frame "extra work that won't fit in NMI"
(typically: heavy tilemap updates, OAM staging, status-bar UI). Up to 3
IRQs fire per frame at H=$50.

`YI_IRQRt` (CODE_00C3E8) wrapper:
```
SEI; push regs; D=$0000; M=8/X=8; DBR=$00
LDA $4211                              ; clear TIMEUP latch (IRQ flag)
LDX $0126                              ; IRQ kind (set by init_scene_regs)
JSR (irq_kind,X)                       ; dispatch (4 entries)
PLB; PLD; PLY; PLX; PLA; CLI; RTI
```

`irq_kind` (DATA_00C40A):

| `$0126` | Handler | Scene type |
|---|---|---|
| `$00` | `irq_default` (CODE_00C412) | In-level / generic |
| `$02` | `irq_story_cutscene` (CODE_00C821) | Story cutscenes (different V-IRQ timings) |
| `$04` | `irq_credits` (CODE_00CA9A) | Credits roll |
| `$06` | `irq_bonus_game` (CODE_00D308) | Bonus / bandit games |

### 4.6 irq_default's 3-phase scanline stepping

State variable `$0125` (irq_count) tracks which of N IRQs this frame is
firing. The default scene-mode pattern:

| Count | At V= | What |
|---|---|---|
| `0` | `$08` | irq_0: disable INIDISP (force-blank for status-bar). Re-arm V-IRQ at `$D8`. |
| `1` | `$D8` | irq_1: restore INIDISP from mirror. If stage-intro flag $0121 != 0, dispatch overlay routine. Re-arm V-IRQ at `$DC`. |
| `2` | `$DC` | irq_2: force-blank, dispatch VRAM-transfer routine via `irq_vram_tx_routines[$011C]`. |

`irq_vram_tx_routines` (DATA_00C47D, 8 entries) routes the heavy work
to the right per-scene path:

| `$011C` | Routine | Scene |
|---|---|---|
| `$00` | `set_v_irq_return` (RTS) | Nintendo Logo |
| `$02` | `irq_normal_level_mode` (CODE_00C48D) | **Normal level** |
| `$04` | `irq_offset_per_tile_levels` (CODE_00C5FE) | 1-7 secret / 6-4 spike-ceiling |
| `$06` | `set_v_irq_return` | Island scenes (no transfer) |
| `$08` | `irq_story_cutscene_credits` (CODE_00C87A) | Cutscene/credits |
| `$0A` | `irq_raphael_the_raven_boss` (CODE_00C641) | Raphael Mode-7 boss |
| `$0C` | `set_v_irq_return` | World map (no transfer) |
| `$0E` | `set_v_irq_return` | Bonus / bandit games |

`irq_normal_level_mode` is structurally similar to `nmi_normal_level`
but covers additional things that don't fit in NMI window: the queued
multi-WRAM DMAs at `$0978` (via CODE_00DE0C), credits tile-animation
chain, etc.

### 4.7 Stage-intro level-name overlay (irq_1, $0121 != 0)

When `$0121` (stage-intro flag) is non-zero, irq_1 takes the
`DATA_level_intro_irq_routines` (`DATA_00C714`, 2 entries) detour:

| `$0123` index | Routine | Effect |
|---|---|---|
| `$00` | `CODE_00C718` (RTS) | no-op tick |
| `$02` | `CODE_00C719 -> CODE_00C71E` | one frame of the "1-1 Make Eggs, Throw Eggs"-style overlay |

`CODE_00C71E` runs the OAM/sprite/Map16 prelude and JSLs through the
SuperFX trampoline to `FXCODE_08B1EF` (per-frame overlay setup). Every
~4 IRQs (when `$0D25 & $03 == 0`) it then JMLs into
`render_stage_intro_level_name` (`CODE_00C778`) which sets up the GSU
to run `FXCODE_09E92F` with:

```
R0:R10  =  DATA_level_name_string_ptrs (FXDATA_5149BC in Bank51) -- 72 dw,
            one per level ID, points at a per-level UI string.
R14     =  !RAM_YI_Level_CurrentLevelFromMapLo (level ID)
R11     =  $0D21 & $003F (LINK destination + per-state byte)
R8      =  $0D1F (vertical scratch)
R9      =  $0D1D (horizontal scratch)
```

The GSU walks the chosen string (`db $FF, x_col, <chars>` lines with
text in YI font encoding, `$FD` terminator) and streams it as tiles
into the BG3 tilemap so the level-name fades in over the screen-clear.

The 72-entry pointer table is laid out as **12 slots per world × 6
worlds**: slots $00..$07 are levels N-1..N-8, slot $08 is `Extra N`,
slots $09..$0B are 3 padding slots that point at
`DATA_level_name_garbage_sentinel` (`DATA_51532F`) -- except world 1's
slot $0B holds `DATA_welcome_to_yoshis_island`, the world-map splash.
The 21 garbage-sentinel slots are unreachable from normal gameplay
because the world map only sets `CurrentLevelFromMapLo` to valid IDs.

---

## 5. Palette loader (full pipeline)

The on-disk palette payload lives at SNES `$3F:A000-$3F:FFFF` (PC
`$1FA000-$1FFFFF`), 8 KB of BGR-15 color words (`0bbbbbgggggrrrrr`). The
CGRAM mirror lives in SRAM at `$70:2000-$70:21FF` (256 x u16 = 512 bytes).
Each scene palette-table entry is 4 bytes / 2 words, bit-packed:

```
Byte 0 : R[7:0]     -- low byte of ROM offset
Byte 1 : R[15:8]    -- high byte (sign bit = dynamic-slot flag)
Byte 2 : d[7:0]     -- CGRAM word destination (x 2 for byte address)
Byte 3 : ssssLLLL   -- high nibble s = number of CGRAM rows to fill (0-15)
                       low nibble  L = colors (words) per row
```

`R` is signed: positive = direct offset from `$3F:A000`; negative = strip
the sign bit, use the remaining value as an index into the dynamic-slot
table at `$7E:0010` (runtime palette swaps -- Yoshi color, animated palette
cycling, mood swaps). Per row, `L` words are copied from ROM to CGRAM;
source advances continuously, destination advances by `$20` (one full
16-color palette row) per row -- one entry can scatter related sub-palettes
across non-contiguous CGRAM rows. (§5.2 restates this; the nibble roles match
the interpreter at `CODE_00BA7A`.) The per-screen breakdown of which program
each scene runs and which CGRAM rows it lands on is in `docs/scene-palettes.md`.

This section covers the runtime code that turns level-header palette IDs
into CGRAM writes.

### 5.1 Top-level entry: load_level_palettes

`load_level_palettes` (CODE_00BA24) is the master in-level entry. It:

1. Sets DBR := `$00`.
2. Computes backdrop pointer: `$130 + LevelHeaderBackgroundColor * 2` -> `$10`.
3. Looks up BG1 palette ptr in `bg1_palette_ptrs[BG1Palette*2]` (or
   `bg1_dark_world_palette_ptrs[*]` for World 6) -> `$12`, plus an
   "alternate" pointer at `$12 + $3C` -> `$1A`.
4. BG2 palette: `bg2_palette_ptrs[BG2Palette*2]` -> `$14`.
5. BG3 palette: `bg3_palette_ptrs[BG3Palette*2]` -> `$16`.
6. Sprite palette: `sprite_palette_ptrs[SpritePalette*2]` -> `$18`.
7. Yoshi color palette: `yoshi_palette_ptrs[YoshiColor*2]` -> `$1C`.
8. Falls through to `load_palettes` with X=0 (start of in-level program).

### 5.2 Palette interpreter: load_palettes

`load_palettes` (CODE_00BA7A) walks `scene_palette_layout` starting at
X, copying palette words to the CGRAM mirror.

Per-entry layout (4 bytes; variable-length program with $FFFF terminator):

| Offset | Field | Meaning |
|---|---|---|
| `0..1` | source word | If positive (high bit clear): literal byte offset into palette blob at `$3F:A000`. If negative (high bit set): index into DP `$0010,Y` (= the pre-cached ptrs at $10/$12/$14/$16/$18/$1A/$1C). Special: `$FFFF` = end-of-program. |
| `2` | CGRAM index | Byte; ASL'd to word address. |
| `3` | size byte | Low nibble = colors per row (transfer size in words). High nibble = number of CGRAM rows to fill. |

The interpreter does a 2-level loop: outer over rows (decremented),
inner over colors-per-row. Each color is written to BOTH `!s_cgram_mirror`
(staging buffer the NMI later DMAs to PPU) AND `$70:2D6C` (secondary
mirror used by fade/HDMA effects).

### 5.3 Per-scene specialisations

| Routine | Entry X | Use |
|---|---|---|
| `load_level_palettes` (BA24) | 0 (in-level) | All level scenes |
| `CODE_00BAEA` | $26 | Special scene palette load |
| `CODE_00BB05` | caller | JSL-callable wrapper |
| `load_world_map_palettes` (BB47) | $6E | World map (per-world pointers) |
| `load_yoshi_color_palette` (BB70) | $C2 | Yoshi-color cycling |
| `load_levelmode_0A_palettes` (BB90) | $D8 | Level mode $0A (6-8 Kamek) |

### 5.4 V-flush

The mirror -> PPU CGRAM transfer happens in EVERY NMI handler that
dispatches CODE_00D4E5: it issues a `$0200`-byte DMA from `$70:2000` (=
`!s_cgram_mirror`) to PPU `$2122` (CGRAM data port). The DMA happens
during force-blank in NMI step 5 (see section 4.3 above), so it's
safe -- no rendering tearing.

### 5.5 Glitch note

The very first iteration of the palette interpreter after boot has an
uninitialised high byte at DP `$01`. The visible result in V1.0 was the
"Yoshi running on the world map" sprite picking up a non-zero high byte
on the first frame, scrolling its color palette unintentionally. The
inline comment in the framework asm (CODE_00BA7A) preserves this note.

### 5.6 Per-frame animated palette (animation_palette)

`load_palettes` (§5.1-5.2) runs ONCE at level load. A second, per-frame path
re-cycles selected CGRAM rows every gameplay frame. `LevelHeaderAnimationPalette`
(header field 11) indexes `DATA_animation_palette_ptr` (`$01:C454`, 21 entries
`$00..$14`) → one of the `anim_pal_*` routines (`$01:C47E`..`C968`), dispatched
by `main_gamemode_0F` (the in-level loop) every frame. `$00`
(`anim_pal_00_noop`) is an RTS; `$13` and `$14` share `CODE_01C968`.

**Mechanism.** Each routine advances its own cycle counters (`$0B73`/`$0B75`/
`$0B77`/`$0B79` phase, `$7974` global animation frame, and for `anim_pal_02` the
player-X velocity), selects a palette row, and copies it into the live CGRAM
mirror `$70:2000` (DMA'd to PPU each NMI, §5.4) plus the fade mirror `$70:2D6C`
via `copy_anim_palette_row` (`$01:C9CF`): `$0E` bytes from `[$00]` (a `$5F:addr`
source pointer) → CGRAM byte-offset X. CGRAM color N = byte `2N`, so e.g.
`anim_pal_01`'s X=`$86` writes BG1 palette row 4 (color 67) for 13 colors.

**Phase-0 = entry palette.** At level entry the phase counters and `$7974` are 0
(bulk WRAM clear), so each routine's table index resolves to 0 — the level's
resting palette. The animation diverges from there as the counters advance;
some routines also gate their first write on an interval/velocity counter, so
the literal frame-0 write may lag the resting row by a frame.

**Routine shapes** (header value → behaviour):

- **Single-row writers** — one `copy_anim_palette_row`. e.g. `$01` colors
  67-79; `$03` colors 112-127; `$08` colors 83-86; `$09` writes one word to
  colors 1 and 9; `$0F` colors 5-7.
- **Header-conditional** — `$0D` picks its source row by `BG3Palette` bit 0;
  `anim_pal_05`'s `CODE_01C644` prefix runs only for `(BG1Tileset & 7) == 0`;
  `CODE_01C85D` (`$0E`, `$13`) selects both source and CGRAM dest by `BG2Palette`
  bit 0; `CODE_01C84E` (`$0E`, `$11`) uses `CODE_01C702` when `BG1Tileset == 8`
  else `CODE_01C611`.
- **Composites** — call several of the above (`$06`/`$07`/`$12`/`$13`).

**Source data** lives in bank `$5F` (= PC `$1F0000 + addr`, the SuperFX-mapped
region that also holds the master palette blob at `$5F:A000`), reached through
the index-0 entries of the Bank01 pointer tables (`DATA_01C47F`, `DATA_01C574`,
`DATA_01C634`, …). A few routines (`$0B`/`$0C`/`$11`/`$12`) also re-arm an HDMA
channel or toggle `MainScreenLayers`/`SubScreenLayers`/`ColorMathSelectAndEnable`
as part of their cycle — screen-register effects layered on top of the CGRAM
write, not part of the palette copy itself.

---

## 6. Graphics loader (LoadGraphics + LZ dispatch)

Two compressed graphics formats are used on-cart, both decoded by the
SuperFX (see `docs/mchip.md` §3.2):

- **LZ2** files (Lunar Compress **FORMAT=1**, NOT FORMAT=0) —
  decompressor at SuperFX `$08:A980` (`FXCODE_08A980` /
  `lz2_decompress`). **Format-agnostic byte stream.** The decompressor
  stages output in SRAM at `$70:5800` and lets the caller decide what to
  do with the bytes. In YI's actual usage the LZ2 pointer table holds
  **265 entries** spanning two content kinds:
  - **115 tile-graphics files** (`Graphics/*.lz2`) — 4bpp CHR tile data
    that gets DMA'd to VRAM tile slots after staging.
  - **150 tilemap files** (`Tilemaps/*.lz2`) — arrays of 16-bit Map16
    indices that get DMA'd to VRAM tilemap regions.

  The GETB/SWAP/OR sequence in the GSU asm builds backref offsets
  big-endian, which is LC_LZ2 semantics (LC_LZ1 / FORMAT=0 uses
  little-endian and does NOT match).
- **LZ16** files (Lunar Compress FORMAT=15) — decompressor at SuperFX
  `$0A:8000` (`FXCODE_0A8000`). **Hardcoded for 4bpp tile graphics.**
  The decompressor has palette/CGRAM-aware setup folded in and streams
  output directly through the SuperFX plot pipeline rather than staging
  in SRAM. It takes a *tile count* (in R3) rather than a destination
  address; the output goes to wherever the GSU's PLOT context is
  configured to deposit it. The LZ16 pointer table holds **187
  entries**, all tile-graphics files (`Graphics/*.lz16`). **LZ16 is
  never used for tilemaps** — the format is tile-shaped end-to-end.

In short: LZ2 is a generic decompressor used for both tile graphics
and tilemaps; LZ16 is a tile-graphics-only decompressor with a tighter
inner loop and zero staging cost. Tile-graphics files are split across
both formats roughly 38%/62%, presumably chosen per asset based on
which format compresses that asset better.

Pointer tables for both formats live in bank `$06`
(`DATA_lz2_compressed_gfx_ptrs` at `$06:F95E`,
`DATA_lz16_compressed_gfx_ptrs` at `$06:FC79`). LZ2 source data covers
PC `$2EBC00-$39BA88`; LZ16 covers `$39BA89-$3F8A36`. This section covers
the runtime code in Bank `$00` that drives a level's compressed-gfx
load.

### 6.1 Top-level entry: load_level_gfx

`load_level_gfx` (CODE_00B339) is the master in-level entry. It:

1. Sets DBR := `$00`.
2. Resolves per-set file indexes into DP `$10..$1C`:
   - BG1: 3 file IDs from `bg1_tileset_files[BG1Tileset*3]` (or
     `bg1_dark_tileset_files[*]` for World 6) -> DP $10/$11/$12.
   - BG2: 2 file IDs from `bg2_tileset_files[BG2Tileset*2]` -> $13/$14.
   - BG3: 2 file IDs from `bg3_tilesets_files[BG3Tileset*2]` -> $15/$16.
   - Sprite: 3 file IDs from `spriteset_files[SpriteTileset*6]` -> $17/$19/$1B
     (also mirrored to $6EB6/$6EB8/$6EBA for persistent cache).
3. Falls through to `load_compressed_gfx_files` with Y=0 (start of
   in-level scene's chunk list in scene_gfx_layout).

### 6.2 The scene gfx layout interpreter

`load_compressed_gfx_files` (CODE_00B39E) walks `scene_gfx_layout`
starting at Y. Each entry is 3 bytes:

| Byte | Meaning |
|---|---|
| `0` | Chunk index. `$00..$EF` = literal compressed-file index. `$F0..$F8` = (byte - $F0) is an index into DP $10..$18 (= the pre-resolved per-set file IDs). `$FF` = end-of-program. |
| `1..2` | VRAM destination address (word, LE). HIGH BIT (`>= $8000`) selects LZ16 format; HIGH BIT clear selects LZ2 format. |

The walker calls `decompress_gfx_file` (CODE_00B507) for each entry and
advances Y by 3 (or 5 for LZ16 entries, see below).

### 6.3 LZ format dispatch (decompress_gfx_file)

| Format | Selection | Decompressor | Purpose | Staging | Notes |
|---|---|---|---|---|---|
| LZ2 (`.lz2` file ext) | VRAM dest high bit CLEAR | FXCODE_08A980 (SuperFX) | Generic byte stream — tile graphics AND tilemaps | SRAM `$70:5800` | 265 entries in the pointer table (115 graphics + 150 tilemaps). Decompressed size = R10's final value - $5800. Caller DMA's to the appropriate VRAM region after decompression. |
| LZ16 (`.lz16`) | VRAM dest high bit SET | FXCODE_0A8000 (SuperFX) | Tile graphics only (4bpp, CGRAM-aware) | direct stream | 187 entries; all tile graphics. Pulls an additional 2-byte uncompressed-size word from the byte AFTER the entry in scene_gfx_layout (so an LZ16 entry is 5 bytes, not 3). |

Both decompressors run on the SuperFX (GSU). The 65816 sets up GSU R0
(bank), R1/R9 (source address), R3 (size hint for LZ16) or R4 (bank for
LZ2) / R10 (SRAM dest for LZ2), then JSL's
`!RAM_YI_Global_BeginSuperFXProcessingRt`. After the GSU finishes,
control returns to the 65816 with R10 holding the end of the
decompressed data.

The decompressed bytes are then DMA'd from SRAM (or the file's
in-place ROM location for LZ16) into VRAM at the destination given by
the scene_gfx_layout entry. This is the inner loop at CODE_00B582 +
CODE_00B729 (which handles multi-128-byte chunks for large transfers).

### 6.4 Per-scene specialisations

| Routine | Entry Y | Use |
|---|---|---|
| `load_level_gfx` (B339) | 0 (in-level) | Standard levels |
| `load_overworld_gfx` (B3CF) | $4F | World map overworld |
| `load_world_map_gfx` (B439) | $A2 | Per-world world-map BG/sprite |
| `load_per_world_variant_gfx` (B49E) | $122 | Per-world variant scenes |
| `load_levelmode_0A_gfx` (B4D3) | $18A | Level mode $0A (6-8 Kamek) |

All converge on `load_compressed_gfx_files`.

### 6.5 Source ptr tables (in Bank06)

The LZ2 file pointers live at `DATA_06F95E` (= `DATA_lz2_compressed_gfx_ptrs`,
PC `$037A88` in cart numbering). The LZ16 file pointers live at
`DATA_06FC79` (= `DATA_lz16_compressed_gfx_ptrs`, PC `$037D9E`). Each is
indexed by `(file_index * 3)` giving 3-byte (24-bit) source pointers.
Bank06 is the asset-pointer-table bank; both tables live in the
upper half so they're SuperFX-bank-mapped: banks `$40-$5F` (and their
HiROM mirrors `$C0-$DF`) map the FULL 64 KB of each bank to PC, not the
standard 32 KB LoROM mapping. So a `$59B3E4` pointer resolves to PC
`0x19B3E4`, not `0x2CB3E4` as standard LoROM math would give. Anything
that consumes these tables must use SuperFX bank arithmetic, not LoROM.

### 6.6 LoROM-mirror equivalence for the SuperFX HiROM region

Because banks `$40-$5F` and banks `$00-$3F` are alternate addressing
schemes for the SAME 2 MB of cart bytes, every byte in the SuperFX
HiROM region has two valid SNES addresses. The framework picks one
(SuperFX-side) for source organization; external references often use
the other (LoROM-side). The mirror math, illustrated for bank `$5F`:

```
SuperFX (HiROM-style, full 64 KB)         LoROM (32 KB upper half)            PC offset
$5F:0000 .. $5F:7FFF                      $3E:8000 .. $3E:FFFF                $1F0000 .. $1F7FFF
$5F:8000 .. $5F:FFFF                      $3F:8000 .. $3F:FFFF                $1F8000 .. $1FFFFF
```

And analogously for `$5E`-`$57` vs `$3D`-`$36`. So the framework's
`DATA_5FA000` is the SAME BYTE as a hypothetical `DATA_3FA000`. External
references in `$3X` form (SMW Central's memory map, parts of the
`yoshisisland-disassembly` wiki) will not find a dedicated `yi/Banks/Bank3F.asm`
because the data lives in `yi/Banks/Bank57.asm` under SuperFX-side labels.
This is why the per-bank file list in `yi/Routine_Macros_YI.asm` jumps from
`Bank17.asm` straight to `Bank4C.asm`: everything between is reached via
the HiROM mirror, sourced in `Bank57.asm`.

PC-offset conversion summary (cart is 2 MB):

| SNES form | PC formula |
|---|---|
| LoROM `$XX:YYYY` for `XX in $00..$3F` | `($XX << 15) \| ($YYYY & $7FFF)` (upper half only) |
| SuperFX `$XX:YYYY` for `XX in $40..$5F` | `(($XX - $40) << 16) \| $YYYY` (full 64 KB) |
| HiROM mirror `$XX:YYYY` for `XX in $C0..$DF` | same PC as SuperFX `$XX-$80` |

Cross-check: `$3F:A000` (LoROM) → `($3F << 15) | ($A000 & $7FFF)` =
`$1F8000 | $2000` = `$1FA000`. `$5F:A000` (SuperFX) →
`($5F - $40) << 16) | $A000` = `$1F0000 | $A000` = `$1FA000`. Same byte.

### 6.7 In-level sprite-VRAM map (sprite → spriteset-file dependency)

The Y=0 (in-level) walk of `scene_gfx_layout` decompresses a fixed set
of chunks into fixed VRAM byte regions. For the OBJ/sprite layer this
nails down *which compressed file a given sprite's tiles come from* —
the dependency that must be re-resolved whenever a level's SpriteTileset
(header field 7) changes.

Parsing the in-level scene (entries are 3 bytes, or 5 for LZ16: a
high-bit-set VRAM dest pulls a trailing 2-byte size word — see §6.3)
gives these sprite-relevant destinations. The dest word carries the
LZ16 flag in bit 15, so the real VRAM word = `dest & $7FFF` and the
byte address = `word * 2`:

| VRAM bytes | layout entry | Source | Role |
|---|---|---|---|
| `$8000-$9FFF` | literal file `$72` | global common sheet | always loaded — **portable** |
| `$F000-$FFFF` | literal file `$19` | global common sheet | always loaded — **portable** |
| `$A000-$A3FF` | `$F7` → DP `$17` | spriteset slot 0 = `spriteset_files[SpriteTileset*6 + 0]` | per-level |
| `$A400-$A7FF` | `$F8` → DP `$18` | slot 1 = `[+1]` | per-level |
| `$A800-$ABFF` | `$F9` → DP `$19` | slot 2 = `[+2]` | per-level |
| `$AC00-$AFFF` | `$FA` → DP `$1A` | slot 3 = `[+3]` | per-level |
| `$B000-$B3FF` | `$FB` → DP `$1B` | slot 4 = `[+4]` | per-level |
| `$B400-$B7FF` | `$FC` → DP `$1C` | slot 5 = `[+5]` | per-level |
| `$B800-$BFFF` | (not loaded by the scene) | SuperFX dynamic-tile stream (slot reserved via `CODE_03AD74`) | per-frame streamed |

The layout's `$F0..$FE` indirections index DP `$10..$1C`; `$F7..$FC`
reach the 6 sprite file IDs `load_level_gfx` wrote to DP `$17..$1C`
(and cached at `$6EB6..$6EBB`, one byte per slot). The two **literal**
entries (`$72`, `$19`) are the global common sprite sheet (Baby Mario,
eggs, watermelon, coins, HUD, score popups) — loaded into fixed VRAM in
every level regardless of spriteset, so any sprite whose tiles live
there renders in any level.

**Reading a sprite's file dependency.** A sprite's draw code emits OAM
records with fixed tile indices into OBJ VRAM. Convert each referenced
tile to a VRAM byte address (standard `$2101` OBJSEL math: name base
bits 0-2 × `$4000` for tiles `0-255`; `+ $2000 + nameSelect*$2000` for
tiles `256-511`), then classify against the table above:

- byte in `$8000-$9FFF` or `$F000-$FFFF` → global sheet → no spriteset
  dependency (renders anywhere).
- byte in `$A000-$B7FF` → spriteset slot `(byte - $A000) / $400`; the
  needed file is that slot's entry in `spriteset_files[SpriteTileset*6]`.
  The dependency is on the **file ID**, not the slot — the same file
  lands at different slot positions across spritesets.
- byte in `$B800-$BFFF` → the SuperFX dynamic-tile region: the sprite
  streams its own graphics per frame rather than depending on a static
  spriteset file.

The `sprite-render` trace scenario applies exactly this classification
(spawn sprite → snapshot OAM → map each tile). The map was confirmed
empirically: slot 0 (Baby Mario) and the coins/watermelons attribute to
the global sheets; spriteset-locked enemies attribute to file IDs that
match their `spriteset_files` row byte-for-byte; dynamic-tile sprites
(e.g. a parent's spawned child) reference the `$B800+` region.

---

## 7. SPC700 upload protocol

The SPC700 ("audio engine") loads its program code from main ROM via a
short IPL handshake. YI invokes this twice:

1. **Boot upload**: yi_reset's phase 3 (X=$10 into set_level_music)
   uploads the SPC engine itself plus the title-screen music block.
2. **Per-level music change**: whenever the level header's music ID
   changes vs. the currently-resident set, set_level_music is called
   with the new ID to upload any newly-needed sample/sequence blocks.

### 7.1 set_level_music / upload_music_data

`set_level_music` (CODE_008543) is the JSL-able entry; if you pass X,
it stores X to `!RAM_YI_Level_LevelHeaderMusicSettingLo`. The shared
body at `upload_music_data` (CODE_008546) then:

1. Looks up `item_denial_table[music_id]`; if non-negative, writes to
   `!RAM_YI_Level_CantUseItemsFlagLo` (some music tracks come with
   "no-items" semantics, e.g. boss tracks).
2. Compares music ID against `$0203` (previous music). If same, return.
3. Looks up `spc_block_set_indexes[music_id]` -> spc_data_blocks row
   index. Each row is 4 bytes: 3 block indexes + $FF terminator.
4. For each new block in the row (compared against `$0207..$020A`
   which is the cached "currently resident block IDs"):
   - Look up the 3-byte source pointer in `SPC_ptr[block_index]`.
   - Store it to DP `$00..$0B` (up to 3 new blocks * 3 bytes).
   - Update `$0207..` cache.
   - Increment `$0C` (count of new blocks to upload).
5. If any new blocks: SEI, send `$FF` to APU port 0 (signal "new
   upload incoming"), JSR SPC700Upload, CLI.
6. Clear APU ports 0-3, clear PlayMusic/PreviousMusic/SoundQueue mirrors.

### 7.2 SPC700Upload (CODE_00841F)

Implements the standard SPC IPL-style handshake. The SPC engine itself
(once resident) speaks this protocol -- not the SNES BIOS.

State table walked from DP $00..$0B:
- `$00..$02` = source ptr of block 0 (immediate upload target)
- `$03..$05` = source ptr of block 1 (queued)
- `$06..$08` = source ptr of block 2 (queued)
- `$0C` = block count (-1; checked via BMI)
- `$0E` = "lo+mid+hi pointer byte cursor" (effectively offset into the
  current block)

The handshake protocol:

```
1. Wait for APU port 0 to read $BBAA (SPC ready signal).
2. Send $CC to APU port 0 (start-of-upload command).
3. For each block, send the dest address (ports 2/3) and a
   kick/continue flag (port 1), and prime the running counter on
   port 0. Then send the block's data 2 bytes at a time (low+high
   interleaved through A). After each 2-byte send, wait for APU port 0
   to echo the counter (the ack), then increment it. The block length
   is held in X as the SNES-side loop count only -- it is never sent
   to the SPC.
4. End each block by sending a zero-size word: SPC then starts
   executing the block's loaded code at the dest address.
```

The protocol is bit-exact -- one byte off and the SPC silently hangs.
SEI is held throughout to prevent NMI from racing the per-byte ack.

### 7.3 Data tables

| Table | Purpose | Entries |
|---|---|---|
| `SPC_ptr` (DATA_0084AC) | Per-block source ptrs (24-bit) | 20 |
| `spc_data_blocks` (DATA_0084E8) | Per-block-set rows (4 bytes: 3 block IDs + $FF) | 14 rows |
| `item_denial_table` (DATA_00851C) | Per-music-track item-disable flag | 18 |
| `spc_block_set_indexes` (DATA_00852E) | Per-music-ID -> spc_data_blocks row index | 21 |

The block contents themselves are in banks `$4E-$4F` (`DATA_4E0000`,
`DATA_4F33F0`, etc); `YI_SPCEngine` is the SPC engine program itself.

---

## 8. DMA + HDMA queue management

Two distinct queues coexist:

### 8.1 VRAM DMA queue (process_vram_dma_queue)

Queue at `$7E:4800`. 12 bytes per entry. Producers push via the
`vram_dma_queue_add_*` helpers (CODE_00BEA6 etc, 6 near-identical
variants for different DMA dest reg + mode combos). Consumer is
`process_vram_dma_queue` (CODE_00E3DF), called from every NMI/IRQ path
that needs to flush VRAM writes.

Entry layout:

```
$00-$01  VRAM dest address (high bit = end-of-queue marker)
$02      video port control (latched to $2115)
$03      DMA control byte (mode + direction + write/read)
$04      DMA dest register low byte ($18 = VMDATAL, $19 = VMDATAH)
$05-$07  source long address
$08-$09  transfer size
$0A-$0B  pointer to next entry
```

`vram_dma_queue_pointers` (DATA_00E3CE) has 3 entries; default is
`$7E:4800` (the active queue), other slots point at fixed init data in
Bank11.

End-of-queue sentinel: an entry whose `$00..$01` has the high bit set
(typically `$4802` is the queue-cleared state -- after the queue is
drained, the queue base is reset so the first slot has $4802 as its
"address" and acts as the sentinel).

### 8.2 Tilemap DMA queue (process_tilemap_dma_queue)

Queue selected by `$0127` index into `tilemap_dma_queue_pointers`
(DATA_00E383, 13 entries). Default (index 0) = `$7E:4002`, the dynamic
queue NMI/IRQ writes to. Other indexes point at ROM-resident pre-baked
tilemap-init streams in various banks (cutscene init, score-screen
init, etc).

Entry format (variable length, more flexible than VRAM queue):

```
$00-$01  VRAM dest (high bit = end-of-queue marker)
$02-$03  vidt tttt tttt tttt
         v = 1 -> column transfer (+$20 per cell); 0 -> row (+1)
         i = 1 -> fixed-source (init/floodfill)
         d = 1 -> read from VRAM (entry has long DEST in $04-$06)
         t = transfer size - 1
$04+     mode-dependent payload:
         - Read mode (d=1): 7-byte entry, $04-$06 = long dest
         - Init mode (d=0,i=1): 6-byte entry, $04-$05 = word floodfill data
         - Write mode (d=0,i=0): (4+t+1)-byte entry, raw data
```

Processor: `process_tilemap_dma_queue` (CODE_00E44A), called from
`prepare_tilemap_dma_queue` which is itself called from NMI/IRQ.

### 8.3 HDMA

YI uses HDMA for per-scanline window scrolling, color-math effects, and
fixed-color gradient backgrounds. The HDMA enable mirror is at
`!RAM_YI_Global_HDMAEnable`; it's restored by NMI/IRQ via
`STA !REGISTER_HDMAEnable` (= `$420C`) at the tail of each handler.

The actual HDMA channel setup (source pointers + per-channel mode) lives
outside Bank `$00`, in per-scene init handlers in Bank01 / Bank0F /
Bank17.

### 8.4 Multi-DMA buffer (CODE_00DE0C)

A specialised queue at `$0978` (8 bytes per entry; size 0 = end). Each
entry is (3 bytes dest + 3 bytes source + 2 bytes size). Used for
multi-WRAM DMAs that need to be batched (e.g. transferring multiple
sprite-tile buffers in one IRQ window). Processed by CODE_00DE0C
during IRQ-2 normal-level. Producer-side: `queue_dma_4args`
(CODE_00BE39) and `queue_dma_3args_plus_a` (CODE_00BE71), both
caller-inline-arg helpers used by Bank01 tilemap-init code.

---

## 9. Fade routines

YI's screen fades are deceptively simple: the brightness mirror (`$0200`,
written to PPU $2100 INIDISP in NMI) is incremented or decremented by 1
per frame, and the GameLoop is held in the appropriate fade game mode
until the brightness reaches the target.

### 9.1 The three fade modes

| Mode | Speed | Use |
|---|---|---|
| `gm_fade_screen_in_out` (CODE_0083CD) | 1 step/frame | Standard fade between scenes (16 frames in or out) |
| `gm_fade_alt` (CODE_0083F0) | 1 step/3 frames | Slow fade (~48 frames) for emotional transitions |
| `gm16_world_end_cutscene_load` (CODE_0083FC) | 1 step/8 frames | Very slow fade (~128 frames) for end-of-world cutscene |

Speed control:
- `gm_fade_screen_in_out`: every frame, just step.
- `gm_fade_alt`: DEC `$0202`; if BPL skip; else reload `$0202 := 2` and
  tail to gm_fade_screen_in_out.
- `gm16_*`: same but reload `$0202 := 8`.

### 9.2 State variables

| Address | Symbolic | Meaning |
|---|---|---|
| `$0200` | INIDISP mirror (low nibble used) | Current brightness 0..15 |
| `$0201` | fade direction | 0 = fading in, 1 = fading out |
| `$0202` | transition step timer | Used by `gm_fade_alt` / `gm16_*` |

Constants:

| Table | Bytes | Indexed by | Meaning |
|---|---|---|---|
| `fade_amount` (DATA_0083C4) | `$01, $FF` | `$0201` | +1 (in), -1 (out) |
| `fade_limit` (DATA_0083C6) | `$0F, $00` | `$0201` | Target brightness |

### 9.3 The step

```
LDX $0201            ; fade direction
LDA $0200            ; INIDISP mirror
AND #$0F             ; isolate brightness
CMP fade_limit,x     ; reached limit?
BNE .add_fade
TXA                  ; \  toggle direction
EOR #$01             ;  | (next fade goes the other way)
AND #$01             ; /
STA $0201
INC !RAM_YI_Global_CurrentGameMode  ; advance to next game mode
BRA .ret

.add_fade
CLC
ADC fade_amount,x    ; +1 or -1
STA $0200            ; write back

.ret
RTL
```

After the brightness reaches the limit, the game mode advances by 1
(by INC of CurrentGameMode), so the next game mode is run on the next
frame. This is how the game's state machine threads fade-out + load +
fade-in into a 3-game-mode chain.

### 9.4 gm1e_start_select_level_fade special

The Start+Select "quit level" fade (game mode $1E) doesn't INC into the
next mode -- it explicitly sets `CurrentGameMode := $20` (prepare
overworld). This is the only fade with a hardcoded "destination" mode.

### 9.5 Per-frame mirror -> PPU

The fade-mode handlers ONLY write to `$0200` (the mirror). The actual
PPU write happens in every NMI handler that includes the line:
`LDA $0200 / STA !REGISTER_ScreenDisplayRegister` (= `$2100`). For
`nmi_normal_level` this is step 9 of section 4.3.

---

## 10. Cross-references

- `docs/leveldataengine.md` -- Bank10-13 level-data parser, Map16 system.
- `docs/levelloader.md` -- the gamemode chain ($22 -> $1E -> $1F -> $0B ->
  $0C -> $0D -> $0E -> $0F) that turns a world-map A-press into a running
  level, plus the level-pointer table that gm$0C reads.
- `docs/mchip.md` -- the SuperFX program (LZ decompressors, player
  physics, Mode-7 boss rendering).
- `docs/bossengine.md` -- per-boss state machines layered on gamemode $0F.
- `docs/spritestateengine.md` -- the per-sprite state engine (Bank03)
  ticked by gamemode $0F.
- `yoshisisland-disassembly/disassembly/bank00.asm` -- per-line annotated
  reference for Bank00, 32% descriptive.
- `yoshisisland-disassembly/docs/named_main_labels.txt` -- complete
  named-label index.
- `yoshisisland-disassembly` wiki, Game-modes page -- per-mode
  plain-English reference.
- See also:
  - `ys_main.asm` -- main loop / GameLoop structure reference.
  - `ys_init.asm` -- reset and boot-time init pipeline reference.
  - `ys_play.asm` -- player integration with the per-frame engine.
  - `ys_game.asm` -- gamemode-handler dispatch reference (mirrors the
    framework's 69-entry game_mode_pointers).

---

## 11. Memory map summary (Bank `$00`)

### 11.1 Direct-page conventions (in interrupt paths)

| Range | Use |
|---|---|
| `$00..$02` | Pointer scratch (execute_ptr table base, palette interpreter source ptr) |
| `$03..$05` | Y-preserve + secondary pointer (execute_ptr_long) |
| `$0A..$0F` | LZ16 size + decompress scratch |
| `$10..$1C` | per-set file/palette pointer cache (load_level_gfx / load_level_palettes) |
| `$20..$25` | DMA src/dest scratch (dma_wram_gen_purpose / dma_init_gen_purpose) |
| `$30` | global frame counter (incremented every GameLoop iteration) |
| `$35, $37` | controller-1 raw + edge-pressed mirrors |
| `$39..$44` | layer scroll position mirrors (Layer1/2/3 X/Y, 16-bit each) |
| `$51` | PlayMusic ID (consumed by NMI handle_sound) |

### 11.2 Page $01 / $02 (in WRAM, controller + per-frame state)

| Address | Symbolic | Use |
|---|---|---|
| `$0100..$010F` | -- | RAM-resident interrupt trampolines (DMA'd at boot) |
| `$0118` | `!RAM_YI_Global_CurrentGameMode` | Current game mode (0..68) |
| `$011B` | -- | Frame-complete sentinel (set by NMI, drained by GameLoop) |
| `$011C` | `!r_interrupt_mode` | NMI dispatch index (set by init_scene_regs) |
| `$011D..$0120` | -- | BG1 hor/vert scroll mirrors for IRQ |
| `$0121` | `!r_stage_intro_flag` | Stage-intro overlay flag |
| `$0125` | `!r_irq_count` | Per-frame IRQ phase counter |
| `$0126` | `!r_irq_setting` | IRQ kind (0..3, for irq_kind dispatch) |
| `$0127` | -- | Tilemap-DMA queue index |
| `$0129` | -- | VRAM-DMA queue index |
| `$012D, $012E` | -- | SCBR / SCMR mirrors (SuperFX) |
| `$0200..$0202` | -- | INIDISP mirror + fade state |
| `$0203` | -- | Currently-resident SPC music ID |
| `$0207..$020A` | -- | Currently-resident SPC block IDs |

### 11.3 Page $07..$0B (sprite/sound queues)

| Address | Symbolic | Use |
|---|---|---|
| `$093C..$0944` | -- | Joypad raw + edge masks |
| `$095E..$096C` | -- | Per-scene $21xx PPU register mirror block |
| `$096D..$0977` | -- | DMA queue arg buffer |
| `$0978+` | -- | Multi-WRAM DMA queue (CODE_00DE0C consumer) |
| `$0B8F` | -- | Frozen-this-frame mask (ambient sprite freeze) |

### 11.4 ExRAM (`$7F:xxxx`)

| Address | Use |
|---|---|
| `!EXRAM_YI_Global_RNGOutputLo` (low) / Hi | 16-bit RNG word (PRNG fed by random_number_gen) |
| `!EXRAM_YI_Level_FreezeSpritesFlag` | Frozen-sprite logic flag |
| `!EXRAM_YI_Level_AmbSpr_*` (stride 4, 60 slots) | Ambient sprite slots |

### 11.5 SRAM (`$70:xxxx`)

| Address | Use |
|---|---|
| `$70:2000..21FF` | CGRAM mirror (load_palettes writes here; NMI DMAs to PPU CGRAM) |
| `$70:2200..25FF` | div_onebyx_lut copy (for SuperFX reciprocal lookup) |
| `$70:2D6C..2F6C` | Secondary CGRAM mirror (for fade/HDMA effects) |
| `$70:5800..7BFF` | LZ1 decompression staging |
| `$70:7E70..7E7D` | SRAM checksum + state guard bytes (checked at boot) |
| `$70:7E80..7FFF` | (save data area, never touched by Bank00) |

---

## 12. Implementation gotchas

- **Don't byte-change Bank00 yi_reset / SPC700Upload / interrupt trampolines.**
  Any single byte difference can brick the boot or hang the SPC handshake.
- **The interrupt trampolines at $7E:0108/$7E:010C are LIVE-PATCHABLE**
  by any code that writes to those WRAM addresses. Used by debug builds
  and (historically) by patching tools.
- **Don't put data after `YI_MainRAMCodeBlock` (`$00:C000`) past
  `ROMBANK00_END` ($00:F7A6) without updating the relocation DMA size.**
  The 16 KB block is sized at link time.
- **scene_palette_layout's negative pointers index `$0010,Y` in DP, not
  the actual cached `$10..$1C` symbols.** The DP layout is implicit;
  callers must pre-populate `$10/$12/$14/$16/$18/$1A/$1C` in that exact
  order before calling load_palettes.
- **LZ16 entries in scene_gfx_layout are 5 bytes, not 3** -- pull an
  extra 2-byte size word from the byte after the entry. The walker
  handles this in CODE_00B520 (`INY INY` to skip).
- **SuperFX bank mapping for compressed-graphics pointers.** Source
  pointers in DATA_06F95E / DATA_06FC79 use SuperFX bank mapping (banks
  `$40-$5F` = full 64 KB per bank), not standard LoROM (32 KB per bank).
  See section 6.5 above for the conversion.
- **NMI / IRQ both push/pop ALL registers.** Don't try to "leak" state
  via D or B from handler to dispatch.
- **The DMA-during-NMI / IRQ paths assume PPU is in force-blank.**
  Always disable_nmi (which also force-blanks) or rely on the NMI/IRQ's
  own STZ INIDISP at entry. Failure to do so produces visible tearing
  on the line being DMA'd.
- **The 16-bit RNG can be observed from any bank.** `random_number_gen`
  is JSL-able and accumulates entropy from the H-counter; the output at
  `!EXRAM_YI_Global_RNGOutputLo` is the 16-bit "low" word.
- **Two of the 222 `Ptrs:` level-data record slots are sentinels, not levels.**
  Rows `$DA`/`$DB` ("seed contest A/B") hold `dl DATA_15FCEA,DATA_15FFD5`, whose
  pointers target 1-byte garbage sentinels rather than real level data; the
  other 220 rows index genuine per-level object/sprite records. Resolve a level
  through the `Ptrs:` pointer table (`$17:F7C3`), not by assuming every slot in
  the index is a populated level.
