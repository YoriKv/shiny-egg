# YI BG2 / BG3 rendering — reimplementation guide

A from-scratch build guide for **Layer 2 (BG2)** and **Layer 3 (BG3)** in Yoshi's
Island: every input each level supplies, the per-LevelMode PPU configuration, the
parallax scroll math, and the HDMA / SuperFX effects that modulate the layers per
scanline. The goal is enough to re-render BG2/BG3 for any level without the cart.

This is the **per-level + algorithmic** companion to `renderingpipeline.md` (the
architecture overview). Where the two overlap, this doc is authoritative for BG2/BG3
because it's backed by per-level runtime captures (see §8).

**Scope.** Everything *after* the tilemap is in VRAM: VRAM layout, the
per-LevelMode register config, parallax scroll, HDMA effects, IRQ composition.
**Out of scope** (already covered): the `Tilemaps/*.lz2` decompression and the Map16
system (BG1) — see `enginecore.md §6` and `leveldataengine.md`. BG2/BG3 are NOT
Map16-stamped; they are whole pre-rendered tilemaps DMA'd to VRAM at level-load.

---

## 1. Per-level inputs (the level header)

BG2/BG3 are driven by 5 fields of the 10-byte packed level header (unpacked to WRAM
by `CODE_unpack_level_header` `$10:8B15`; bit-widths `DATA_108B05`; continuous
MSB-first bitstream). The fields, with their unpacked WRAM word addresses:

| Field | WRAM | bits | Role |
|---|---|---|---|
| BackgroundColor | `$0134` | 5 | Backdrop color **or** sky-gradient selector (≥ `$10` ⇒ gradient — see §6.1) |
| BG2 Tileset | `$013A` | 5 | Selects the BG2 pre-rendered tilemap + char gfx files |
| BG2 Palette | `$013C` | 6 | BG2 CGRAM block (`bg2_palette_ptrs[v*2]`) |
| BG3 Tileset | `$013E` | 6 | Selects the BG3 tilemap + char gfx files |
| BG3 Palette | `$0140` | 6 | BG3 CGRAM block (`bg3_palette_ptrs[v*2]`) |
| LevelMode | `$0146` | 5 | Selects the scene-register row + IRQ behavior (§3, §4) |
| BGScrollSetting | `$014C` | 5 | Parallax-rate index (§5) |

A static decode of all 222 levels' BG2/BG3 fields + LevelMode + scroll + bg-color is
in `tmp/bg23/level-bg23-atlas.tsv` (regenerable from `reference.sfc` via the header
bit-unpack; the Ptrs table at `$17:F7C3`, row `lid*6`, `+0` = level-data/header ptr).
**LevelMode distribution** across the 222 levels: `$00`=53, `$05`=45, `$0B`=47,
`$0F`=14, `$06`/`$07`/`$0E`=11–12, `$03`=8, `$08`/`$0C`=5, `$01`/`$02`/`$0A`=3,
`$09`/`$0D`=1.

The tileset → gfx-file and palette pointer tables are the BG2/BG3 analog of BG1's
`DATA_bg1_tileset_files`; the gfx loader (`load_level_gfx`, `enginecore.md §6`) DMAs
the selected pre-rendered tilemap to the BG2/BG3 tilemap VRAM regions and the char
gfx to the char regions. The tilemap source files are `Tilemaps/*.lz2` (16-bit
tilemap-entry arrays; entry = `vhopppcc cccccccc` — 10-bit tile, 3-bit palette,
priority, H/V flip — standard SNES tilemap format).

---

## 2. BG2 / BG3 VRAM layout

From the per-LevelMode scene registers (`§3`), captured live across all modes
(`bg23-render` scenario). For the common in-level modes the VRAM layout is
**mode-invariant**:

| Register | Mirror | Typical value | Meaning for BG2/BG3 |
|---|---|---|---|
| BG2SC `$2108` | `$0960` | `$3A` | BG2 tilemap base `= ($3A & $FC) << 8 = $3800` word; size bits `$3A & 3` |
| BG3SC `$2109` | `$0961` | `$34` | BG3 tilemap base `= ($34 & $FC) << 8 = $3400` word; size bits |
| BG12NBA `$210B` | `$0962` | `$77` | BG2 char base = high nibble `$7` `<< $1000` ⇒ `$7000` word |
| BG34NBA `$210C` | `$0963` | `$02` | BG3 char base = low nibble `$2` `<< $1000` ⇒ `$2000` word |

So in the standard layout (all in VRAM **word** addresses): **BG2 tilemap at `$3800`,
BG3 tilemap at `$3400`, BG2 char at `$7000`, BG3 char at `$2000`** (byte offsets in
`vram.bin` are 2×: `$7000` / `$6800` / `$E000` / `$4000`). Verified against the
`lvl00` capture — each region holds dense tilemap/char data at exactly these offsets.
SC base = `(BGxSC & $FC) << 8`; char base = `nibble << $1000` (4 K-word units).

Note (`renderingpipeline.md §5.4`): a BG2 tilemap entry's 10-bit tile field can
**wrap past `$FFFF`** when char-base + tile-index exceeds VRAM, deliberately sharing
graphics with BG1/HUD regions; the cart hides the wrapped rows by scrolling them
off-screen (scroll-as-occlusion). BG3 keeps its indices within its char chunk.

---

## 3. Per-LevelMode scene configuration (THE map)

Each LevelMode selects a row of `DATA_scene_register_layout` (`$00:BBEA`, 22×20,
indexed via `DATA_scene_layout_indices` `$00:BBAF` — flat `mode*20` for all 15 used
modes). `CODE_init_scene_regs` (`$00:BDA2`) copies the row's 15 register mirrors
(`$7E:095E–096C`) to the PPU once per scene-load. **But `irq_normal_level_mode`
rewrites BGMODE/TM/CGWSEL + every scroll register each frame at scanline `$DC`
(§4)** — so the *in-level-area* config differs from the scene-table preset.

The table below is the **live in-level config** captured per LevelMode (the
`bg23-render` sweep — post-IRQ values, i.e. what actually renders the level area):

| Mode | IRQ routine | BGMODE | TM | TS | BG2SC | BG3SC | BG12NBA | BG34NBA | CGWSEL | CGADSUB | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `$00` | normal | `$69` | `$17` | `$00` | `$3A` | `$34` | `$77` | `$02` | `$22` | `$20` | L3 above L2 |
| `$01` | normal | `$69` | `$14` | `$03` | `$3A` | `$34` | `$77` | `$02` | `$22` | `$20` | |
| `$02` | normal | `$69` | `$13` | `$04` | `$3A` | `$34` | `$77` | `$02` | `$22` | **`$B3`** | color math on |
| `$03` | **offset-per-tile** | **`$22`** | `$11` | `$02` | `$3A` | `$34` | `$77` | `$02` | `$22` | `$20` | **BG Mode 2**, no L3; per-tile BG3 offset (§6.4) |
| `$05` | normal | `$69` | `$15` | `$02` | `$3A` | `$34` | `$77` | `$02` | `$22` | `$20` | L3 below L2 (1-1) |
| `$06` | normal | `$69` | `$15` | `$02` | `$3A` | `$34` | `$77` | `$02` | `$22` | `$24` | |
| `$07` | normal | `$69` | `$11` | `$02` | `$3A` | `$34` | `$77` | `$02` | `$22` | `$20` | |
| `$08` | normal | `$69` | `$13` | `$00` | `$3A` | `$34` | `$77` | `$02` | `$22` | `$20` | |
| `$09` | **raphael (Mode 7)** | **`$07`** | `$11` | `$04` | `$00` | `$00` | `$00` | `$00` | `$22` | `$20` | Raphael: Mode-7, BG2/BG3 off (§6.5) |
| `$0A` | normal | **`$00`** | `$1F` | `$00` | `$28` | `$30` | `$77` | `$77` | `$02` | `$20` | Kamek autoscroll: BG Mode 0, different bases |
| `$0B` | normal | `$69` | `$11` | `$06` | `$3A` | `$34` | `$77` | `$02` | `$22` | `$20` | |
| `$0C` | normal | `$69` | `$15` | `$00` | `$3A` | `$34` | `$77` | `$02` | `$22` | `$20` | |
| `$0D` | normal | **`$59`** | `$05` | `$12` | `$69` | `$34` | `$77` | `$02` | `$22` | `$45` | |
| `$0E` | normal | `$69` | `$13` | `$04` | `$3A` | `$34` | `$77` | `$02` | `$22` | **`$B3`** | color math on |
| `$0F` | normal | `$69` | `$04` | `$13` | `$3A` | `$34` | `$77` | `$02` | `$22` | `$24` | |

`TM`/`TS` bits: `b0`=BG1, `b1`=BG2, `b2`=BG3, `b4`=OBJ. So e.g. mode `$05` TM=`$15`
= BG1+BG3+OBJ on the main screen, TS=`$02` = BG2 on the subscreen (BG2 composited via
color math). CGADSUB `$20` = color-math disabled-ish (backdrop only); `$B3`/`$45`/`$24`
= active add/subtract selecting specific layers.

**BGMODE low 3 bits → SNES BG mode → per-layer COLOUR DEPTH.** This is easy to
miss: a layer's bit depth is set by the BG mode, NOT fixed per layer, and it
drives every tile renderer's byte stride (16 vs 32), decoder, and palette-group
size. Almost every LevelMode is **BG Mode 1** (BGMODE low nibble `$9`): BG1/BG2
4bpp, BG3 2bpp. The exceptions:
- LevelMode `$03` → **BG Mode 2** (BGMODE `$22`): BG1/BG2 4bpp, BG3 = per-tile
  offset data (not a pixel layer).
- LevelMode `$09` → **BG Mode 7** (BGMODE `$07`): BG1 8bpp (Mode-7), BG2/BG3 off.
- LevelMode `$0A` → **BG Mode 0** (BGMODE `$00`): **ALL backgrounds 2bpp** — so
  BG1 is 2bpp here, the lone level (`$6B`) where BG1 is not 4bpp. Decoding it as
  4bpp scrambles every tile. (Engine side: derive bpp from BGMODE via
  `scene-regs.ts` `bgLayerBpp`, never hardcode.)

---

## 4. Per-scanline IRQ reconfiguration (resolved)

The cart runs a 3-stage V-IRQ chain (`enginecore.md §4.6`). For BG2/BG3 the relevant
stage is **IRQ 2 at V=`$DC`**, which dispatches by the runtime interrupt-mode byte
`$011C` into `irq_vram_tx_routines`:

- **`$011C` = `$02` → `irq_normal_level_mode`** — runs for **every standard in-level
  mode** (verified at runtime across all modes except $03/$09). Rewrites
  BGMODE, BG1SC, BG3SC, BG12NBA, TM, TMW, MosaicEnable, WOBJSEL, CGWSEL, and **every
  BG1/BG2/BG3 scroll register** at scanline `$DC` from the WRAM mirrors. This is why
  the live BGMODE/TM (§3) differ from the scene-table preset.
- **`$011C` = `$04` → `irq_offset_per_tile_levels`** — LevelMode `$03` only (§6.4).
- **`$011C` = `$0A` → `irq_raphael`** — LevelMode `$09` (Mode-7 boss).

> **Correction to `renderingpipeline.md §3.3`:** the IRQ routine is selected by the
> *runtime* `$011C` byte, not the scene-table `+0`/`+1` preamble bytes directly. The
> scene-table preamble is processed into `$011C`/`$0126` during scene-load; the
> in-level value of `$011C` is `$02` for all normal modes (this doc's captures).

Above the level area, IRQ 0 (V=`$08`) force-blanks scanlines `0–7`; IRQ 1 (V=`$D8`)
restores brightness and (if stage-intro) overlays the level-name into BG3.

---

## 5. Parallax scroll math

BG2/BG3 scroll positions are derived from the camera each frame, then the NMI copies
them to the PPU scroll registers. The derivation is `CODE_04FD28` (Bank04) which
hands off the multiply to the **SuperFX** (`FXCODE_0993B3`).

### 5.1 The rate tables (per BGScrollSetting)

`BGScrollSetting` (`$014C`) `× 2` indexes **6 parallel rate tables**; each rate is an
8.8 fixed-point coefficient applied to a camera component:

| Table (→ GSU reg) | Applies to | `$0100` | `$0080` | `$0040` | `$0020` | `$0000` | `$FFFF` | `>$0100` |
|---|---|---|---|---|---|---|---|---|
| `DATA_04FB6E` → R8 | BG2 X | 1:1 | ½ | ¼ | ⅛ | static | inverse | faster |
| `DATA_04FBAE` → R9 | BG2 Y | … | | | | | | |
| `DATA_04FBEE` → R10 | BG3 X | | | | | | | `$0133`=1.2× |
| `DATA_04FC2E` → R11 | BG3 Y | | | | | | | |
| `DATA_04FC6E` → R12 | aux X (secondary BG3 / effect) | | | | | | | `$0166` |
| `DATA_04FCAE` → R13 | aux Y | | | | | | | |

(Layer↔register mapping inferred from the output stores in §5.2; R8/R9 → BG2 X/Y,
R10/R11 → BG3 X/Y, R12/R13 → an auxiliary pair used by special tilesets.)

The first 22 `BGScrollSetting` rows of each table (full values in
`tmp/bg23/rate-tables.txt`):

```
bgScroll:             00   01   02   03   04   05   06   07   08   09   0A   0B   0C   0D ...
R8/FB6E  (BG2 Xrate): 0040 0080 0100 0080 0080 0080 0080 0080 0040 00c0 0080 00c0 0000 0080
R9/FBAE  (BG2 Yrate): 0040 ffff ffff 0040 0040 0040 0040 0040 ffff 0060 0040 ffff 0000 ffff
R10/FBEE (BG3 Xrate): 0020 0040 0100 0100 0000 0040 0133 0080 0040 0040 0020 0000 0040 0000
R11/FC2E (BG3 Yrate): 0020 ffff ffff ffff 0000 0040 0133 0040 ffff 0020 0020 0000 0020 0000
R12/FC6E (aux Xrate): 0100 0100 0100 0100 0100 0100 0166 0000 0100 0100 0100 0000 0000 0100
R13/FCAE (aux Yrate): 0100 0100 0100 0100 0100 0100 0000 0000 0100 0100 0100 0000 0000 0100
```

### 5.2 The multiply (FXCODE_0993B3, SuperFX)

`CODE_04FE43` loads the 6 rate values into GSU R8–R13 (with tileset overrides: if
BG1Tileset==`$03`, R10←0; if BG3Tileset==`$1C`, R11 special; etc.), then calls
`FXCODE_0993B3`. The GSU routine, per component:

```
LayerScroll = (cameraComponent * rate) >> 8        ; LMULT, 8.8 fractional
```

It reads camera-X (`$70:0094`) into R1, multiplies by R8 (`LMULT`), accumulates the
high/low halves, and stores to `$6096` (→ Layer2XPos); repeats with R10 → Layer3X,
etc. Outputs land at `$6096`=Layer2X, `$609E`=Layer2Y, `$6098`=Layer3X,
`$60A0`=Layer3Y (Bank04 copies these to the DP mirrors `$3D/$3F`=BG2 X/Y,
`$41/$43`=BG3 X/Y).

**Tileset special-cases** (Bank04 `$04FE43+`): BG3Tileset `$1A` adds a per-frame
moving offset (`$7974>>2 + $0C90`) to Layer3X — a self-scrolling BG3 (water/clouds);
BG3Tileset `$2D` sets Layer3X = camX + `$7974>>3` and Layer3Y = camY (another
self-scroller); BG3Tileset `$1C` calls `CODE_04FF06` and zeroes R11; BG1Tileset `$03`
zeroes R10. BGScrollSetting `$0D` is a special vertical-tracking mode (follows the
player Y in player-state `$08`). The `$7974` term is a free-running per-frame counter.

### 5.3 NMI copy to PPU

The normal-level NMI tail (`$00:C1xx`, before `CODE_00C1DF`) copies the DP mirrors to
the PPU write-twice scroll registers: Layer2 X/Y → `$210F/$2110` (BG2HOFS/VOFS),
Layer3 X/Y → `$2111/$2112` (BG3HOFS/VOFS), each as a Lo-then-Hi byte pair.
`irq_normal_level_mode` re-writes them again at V=`$DC` for the level area.

**Reimplementation:** `BG2HOFS = (camX * R8rate[bgScroll]) >> 8`, etc. — a single
fractional multiply per layer/axis. `$0100`=lock-to-camera, smaller=slower parallax,
`$0000`=fixed, `$FFFF`=scroll opposite the camera, `>$0100`=foreground-faster.

---

## 6. HDMA / SuperFX effects

Armed at level-load by `CODE_hdma_and_gradient_init` (`$01:D5B3`), gated per-channel
by `!RAM_YI_Global_HDMAEnable` (`$0D40` mirror of `$420C`). Channel allocation
(`bossengine.md §4.1`, applies to normal levels):

| Ch | Dest | Effect |
|---|---|---|
| 1,2 | `$2132` COLDATA | **Sky gradient** (split top/bottom) — §6.1 |
| 3,4 | `$210F/$2110` BG3 HOFS/VOFS | **BG3 scroll modulation** (wavy water, sun) — §6.2 |
| 5 | `$2126` WH0 | Window-mask left edge (fog cutout, spotlight) — §6.3 |
| 7 | `$210F` BG3HOFS | additional sun/mist mod |

Of the 56 slot-bootable levels swept, **5 arm HDMA** (`HDMAen=$EB/$EC`): `$02 $12 $19
$2D $34`. The rest render BG2/BG3 with **plain scroll only** (no HDMA).

### 6.1 Sky gradient (the COLDATA stream)

- **Selector:** the BackgroundColor header field (`$0134`). Values `< $10` = a solid
  backdrop color (CGRAM index 0). Values `≥ $10` = a **gradient** index.
- **Generation:** `CODE_hdma_and_gradient_init` reads the gradient definition
  (`!RAM_YI_Level_BGGradientBlueTable` + R/G counterparts, keyed by BackgroundColor),
  sets up GSU R0/R1, and kicks **`FXCODE_0890E7`**. That GSU routine reads the
  keyframe colors from ROM (`ROMB`/`GETB` at `ROMBR:R14`), decomposes each into 5-bit
  R/G/B (`AND $1F` + shifts), and **interpolates a 256-entry per-scanline gradient**
  into `$70:5800` (one fixed-color BGR triple per scanline).
- **Transfer:** a DMA copies `$70:5800` → `$7F:56DE` (WRAM); HDMA channels 1+2 then
  stream `$7F:56DE` → `$2132` (COLDATA) per scanline, split for the top/bottom halves.
- **Application:** color math (CGADSUB selecting backdrop/layers, CGWSEL fixed-color)
  blends the per-scanline fixed color → the smooth sky gradient. **Without the GSU +
  HDMA, the sky is a flat color.**
- The `gradient.bin` capture per level holds `$70:5800` (256 B GSU output) + `$7F:56DE`
  (256 B WRAM copy). NOTE: `$70:5800` carries ~40 leftover nonzero bytes even when the
  gradient is unused — the **`HDMAEnable` channel-1 bit** is the authoritative "gradient
  on screen" signal, not the table's nonzero count.

### 6.2 BG3 scroll-modulation (wavy water, sun)

HDMA channels 3/4/7 stream per-scanline offsets to BG3HOFS/VOFS, producing the wavy
water surface and the radial "sun rays" mod. The tables come from
`!RAM_YI_Global_HDMA_BG3VScrollTable` + GSU-computed per-frame updates (a sun/mist
rasteriser in Bank08). Detected in levels `$12`/`$2D` (this doc's `fxSun` flag).

### 6.3 Window-mask (fog cutout / spotlight)

HDMA channel 5 streams the Window-1 left edge to `$2126` (WH0), carving a per-scanline
window used for fog cutouts and cave spotlights. Buffer at `$7E:2400` (`winmask.bin`
capture).

### 6.4 Offset-per-tile BG3 (LevelMode `$03`)

LevelMode `$03` uses **BG Mode 2** (BGMODE=`$22`) with per-tile BG3 offset
(`irq_offset_per_tile_levels`, `$011C`=`$04`) — the "3D rock / fuzzy" effect; BG3 is
unavailable as a normal layer in this mode. Representative levels: `$06 $2F $30`.

### 6.5 Mode-7 / circular BG3 (LevelMode `$09`, Raphael)

Raphael's moon fight is **LevelMode `$09`**: `load_levelmode_09_settings` (`$01:B0E5`)
installs a custom HDMA set + Mode-7 (BGMODE=`$07`, BG2/BG3 off). The "BG3 that wraps
in a circle around the moon" is rendered via Mode-7; `FXCODE_088B49` solves the
per-frame rotation matrix for Raphael's polar walk. Representative: lid `$CB`.

### 6.6 Hookbill fog (boss cinematic — not a level effect)

The Hookbill fog is **driven by the boss sprite** (`$0AE`) state machine
(`CODE_018025+` in Bank01: `hookbill_init_fog` → `_fog_left` → `_fog_stay` →
`_fog_fade`), not by LevelMode or level-load. It enables color-math subtract, advances
a per-line SuperFX raster (refs `FXCODE_089208` + `FXCODE_08AA7F`), and clears its HDMA
channel on fade-out. It is **not statically capturable** (needs the fight to reach the
fog phase) — see `bossengine.md §2.2 / §4.2`.

> **Correction to `renderingpipeline.md §5.2`:** `FXCODE_08AA7F` is `CODE_ram_byte_copy`
> (a generic byte-copy the fog raster *uses*), not a dedicated "fog renderer." The fog
> is the Bank01 Hookbill state machine + its per-line raster.

---

## 7. The "where do BG2/BG3 pixels come from" summary

1. **Header** picks the BG2/BG3 tileset (→ pre-rendered tilemap + char gfx files) and
   palette (→ CGRAM block), the LevelMode (→ scene registers + IRQ), the BackgroundColor
   (→ gradient or solid), and the BGScrollSetting (→ parallax rates).
2. **`load_level_gfx`** DMAs the decompressed tilemap to the BG2/BG3 tilemap VRAM
   regions (BG2 `$3800` / BG3 `$3400` word) and char gfx to the char regions (BG2
   `$7000` / BG3 `$2000` word); palettes to CGRAM.
3. **`init_scene_regs`** sets initial PPU layer/color-math/window registers from the
   LevelMode row.
4. **Per frame:** the camera → `FXCODE_0993B3` → BG2/BG3 scroll positions; the NMI
   copies them to the PPU; `irq_normal_level_mode` re-applies BGMODE/TM/CGWSEL + scroll
   for the level area at V=`$DC`.
5. **Per scanline (effect levels only):** HDMA streams the COLDATA gradient (sky),
   BG3 scroll-mod (water/sun), and/or window-mask (fog) — the GSU regenerates the
   gradient/sun tables each frame.
6. **PPU composites** BG2/BG3 with BG1+OBJ per TM/TS/CGADSUB/CGWSEL **for that scanline**.

---

## 8. Reference captures & reproduction

Scenario: **`trace-harness/scenarios/bg23-render/`** — build-once, loads any level by
`paramsText` (`slot=$XX | world=$XX`, or `warp=$XX | wworld=$XX | wx | wy | went`) and
captures a settled gm`$0F` frame. The load uses CurrentWorld (`$0218`) + a top-of-WRAM
sentinel (`$7F:FFFF`) + the screen-exit warp path (see the scenario). Run with
`--reuse-build` to sweep (the level is a runtime WRAM write, not a build define).

Per-level capture (`output/lvl<LID>/`): `regs.txt` (scene/IRQ regs + scroll mirrors +
camera + header fields + HDMAen), `vram.bin` (64 KB), `cgram.bin`, `gradient.bin`
(`$70:5800` + `$7F:56DE`), `winmask.bin` (`$7E:2400`), `gsu-fx.txt` (GSU exec PCs). One
signature row per level → `output/bg23-signatures.tsv` (the per-mode/effect index).

Representative levels (one per distinct behavior): plain `$00`/`$01`; HDMA-gradient
`$02`/`$19`/`$34`; sun `$12`/`$2D`; offset-per-tile `$06`/`$2F`/`$30`; Mode-7/circular
`$CB`; color-math `$5A`/`$7A`; + one warp-rep per LevelMode without a slotted level.
The static atlas + rate tables live in `tmp/bg23/`.

Two slotted levels (`$38` mode `$0E`, `$39` mode `$05`) didn't reach gm`$0F` via
slot-force (special sub-level boots) and weren't captured — but their LevelModes are
both covered by other representatives, so no behavior is missing.

---

## 9. Reimplementation checklist

- [ ] Decode the 5 header fields per level (§1).
- [ ] Load the BG2/BG3 tilemap + char gfx + palette into the VRAM regions of §2.
- [ ] Apply the LevelMode's in-level register config (§3) — TM/TS/BGMODE/SC/NBA/
      CGWSEL/CGADSUB (use the in-level, post-IRQ values, not the scene-table preset).
- [ ] Each frame: `BG2/BG3 scroll = (camera * rate[BGScrollSetting]) >> 8` (§5), with
      the tileset special-cases.
- [ ] If BackgroundColor ≥ `$10`: build the 256-entry COLDATA gradient (§6.1) and apply
      it via color math per scanline.
- [ ] Handle the effect modes: offset-per-tile (`$03`), Mode-7 (`$09`); BG3 scroll-mod
      (water/sun) and window-mask (fog) where the HDMA channels are armed.

## 10. Cross-references

| Topic | Where |
|---|---|
| Rendering architecture / contributor map | `renderingpipeline.md` |
| Level header bit layout | `leveldataengine.md §3`, `WRAM_GameMode_Header.asm` |
| Tilemap `.lz2` decompression + gfx loader | `enginecore.md §6` |
| Palette pipeline (CGRAM mirror → PPU) | `enginecore.md §5` |
| NMI / IRQ 3-phase stepping | `enginecore.md §4.3, §4.6` |
| HDMA channel allocation | `bossengine.md §4.1` |
| Hookbill fog cinematic | `bossengine.md §2.2, §4.2` |
| Level-load chain (LevelMode dispatch) | `levelloader.md §1` |
