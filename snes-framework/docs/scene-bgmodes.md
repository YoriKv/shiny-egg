# YI PPU background mode per scene

Which SNES PPU **background mode** (`$2105` low 3 bits) and resulting **per-layer
color depth** each top-level screen uses — boot logo, storybook intro, title
screen, overworld map, and normal gameplay.

This is the **whole-game** view. For the exhaustive per-LevelMode breakdown of
*in-level* configuration (all 15 level modes, TM/TS/SC/NBA/color-math), see
`bg23rendering.md` §3 — that doc is authoritative for gameplay; this one places
gameplay alongside the non-level screens it doesn't cover.

---

## 1. How the mode gets set

Code almost never writes `$2105` (BGMODE) directly. Instead:

1. A per-scene **20-byte row** in `DATA_scene_register_layout` (`$00:BBEA`,
   `yi/Banks/Bank00.asm:5940`) holds 15 PPU-register mirror values starting at
   byte **+$05**. Byte **+$05** is the `$2105` (BGMODE) value; byte **+$0E** is
   `$212C` (main-screen layer enable).
2. `CODE_init_scene_regs` (`$00:BDA2`, `yi/Banks/Bank00.asm:6057`) copies the
   row's 15 mirrors to `$7E:095E–096C` (`!RAM_YI_Global_BGModeAndTileSizeSetting`
   is the first) and fans them out to the real `$2100`-region registers via
   `DATA_reg_mirror_mapping` (`$00:BBDB`). Mirror index 0 → `$2105`, index 9 →
   `$212C`.
3. The caller selects the row by loading `X` and calling `init_scene_regs`. `X`
   is a **byte offset** into the word table `DATA_scene_layout_indices`
   (`$00:BBAF`), which yields the row's byte offset (rows are stride 20).

The **title screen is the exception** — it does not hold one static `$2105`; an
HDMA channel streams two BGMODE values down the frame (§3, title row).

### 1.1 BGMODE (`$2105`) bit decode

```
 bit 7 6 5 4 3 2 1 0
     │ │ │ │ │ └─┴─┴─ BG mode (0..7)
     │ │ │ │ └─────── mode-1 BG3 high-priority
     │ │ │ └───────── BG1 tile size (1 = 16x16, 0 = 8x8)
     │ │ └─────────── BG2 tile size
     │ └───────────── BG3 tile size
     └─────────────── BG4 tile size
```

Per-layer **color depth follows from the mode**, not from the layer:

| BG mode | BG1 | BG2 | BG3 | BG4 | Notes |
|---|---|---|---|---|---|
| 0 | 2bpp | 2bpp | 2bpp | 2bpp | |
| 1 | 4bpp | 4bpp | 2bpp | — | the YI workhorse |
| 2 | 4bpp | 4bpp | (offset-per-tile) | — | BG3 is per-tile offset data, not a pixel layer |
| 3 | 8bpp | 4bpp | — | — | |
| 5 | 4bpp | 2bpp | — | — | hi-res 512 |
| 7 | 8bpp | — | — | — | single rotation/scaling layer |

`$212C`/`$212D` (TM/TS) bits: `b0`=BG1, `b1`=BG2, `b2`=BG3, `b3`=BG4, `b4`=OBJ.

---

## 2. Summary

| Scene | `$2105` | BG mode | Main screen (`$212C`) | Per-layer depth (enabled layers) |
|---|---|---|---|---|
| Nintendo Presents boot logo | `$01` | **Mode 1** | `$13` = BG1+BG2+OBJ | BG1 **4bpp** (the white text), BG2 4bpp |
| Storybook intro (gm38/39) | `$69` | **Mode 1** | `$17` = BG1+BG2+BG3+OBJ | BG1 4bpp, BG2 4bpp, BG3 2bpp |
| Title — top ~118 scanlines | `$10` | **Mode 0** | `$13` = BG1+BG2+OBJ | BG1 2bpp (clouds/sky), BG2 2bpp (logo) |
| Title — bottom ~106 scanlines | `$07` | **Mode 7** | `$11` = BG1+OBJ | **BG1 8bpp** = SuperFX rotating island |
| Overworld map | `$01` | **Mode 1** | `$17` = BG1+BG2+BG3+OBJ | BG1 4bpp, BG2 4bpp, BG3 2bpp |
| In-level (LevelMode `$00`, most common) | `$69` | **Mode 1** | `$17` = BG1+BG2+BG3+OBJ | BG1 4bpp, BG2 4bpp, BG3 2bpp |

Only the title screen leaves Mode 1: its top band is Mode 0 (the logo/clouds, all
2bpp) and its bottom band is Mode 7 (the 8bpp SuperFX island). Everything else —
boot logo, storybook, overworld, and gameplay — is Mode 1.

---

## 3. Per-scene detail

### Nintendo Presents boot logo — Mode 1 (`$01`)

`CODE_gm00_ninpresents_prep` (`$10:838B`, `yi/Banks/Bank10.asm:474`) does
`LDX #$02 : JSL CODE_init_scene_regs`. `X=$02` indexes `DATA_scene_layout_indices`
at byte offset 2 = the second word (`$0014`) = **row 1** of
`DATA_scene_register_layout`. Row 1's BGMODE byte is `$01` (Mode 1, 8x8 tiles,
BG3-priority off); its main-screen byte is `$13` = BG1+BG2+OBJ.

The "Nintendo presents / ©1995…" text is plotted by the SuperFX to **BG1**
(`yi/Banks/Bank10.asm:537`), so the visible text is 4bpp. (`prep` briefly pokes
the `$212C` register to `$10` during the gfx-load force-blank, but the NMI re-copies
the `$13` shadow once display resumes, so BG1+BG2+OBJ is what shows.)

### Storybook intro — Mode 1 (`$69`)

`CODE_gm38_load_intro_cutscene` (gamemode `$38`, `$10:DA33`,
`yi/Banks/Bank10.asm:10627`) — the "once upon a time" baby-delivery sequence —
does `LDX #$04 : JSL CODE_init_scene_regs`. `X=$04` → word `$0028` = **row 2** =
BGMODE `$69` (Mode 1, BG3 high-priority, BG2/BG3 16x16 tiles), main-screen `$17`
= BG1+BG2+BG3+OBJ.

The page-turn / spin effect is SuperFX bitmap work pushed through ordinary
Mode-1 layers — it is **not** PPU Mode 7. (gm39, `$10:DCAD`, kicks the GSU every
frame; the scene row also seeds the SuperFX SCBR/SCMR registers.)

### Title screen (island) — HDMA split: Mode 0 over Mode 7

The rotating/morphing island is a **mid-frame BGMODE switch** driven by an HDMA
channel on `$2105`. The HDMA descriptor (`yi/Banks/Bank17.asm:128`) targets
`!REGISTER_BGModeAndTileSizeSetting` with table `DATA_178070`
(`yi/Banks/Bank17.asm:131`):

```
db $76,$10, $6A,$07, $00
   │   │    │   │     └ terminator
   │   │    │   └────── 106 scanlines: write $07 (Mode 7)
   │   │    └────────── (line count for the second block)
   │   └─────────────── 118 scanlines: write $10 (Mode 0)
   └─────────────────── (line count for the first block)        118 + 106 = 224
```

- **Top ~118 lines: `$10` → Mode 0** (BG1 16x16). All layers 2bpp. Main-screen
  `$13` = BG1+BG2+OBJ: BG2 carries the "Yoshi's Island" logo, BG1 the sky/clouds.
- **Bottom ~106 lines: `$07` → Mode 7** (8bpp single layer). Main-screen `$11` =
  BG1+OBJ: **BG1 is the SuperFX-rendered rotating island and sea, at 8bpp.**

`CODE_init_scene_regs` (called with `X=0` = row 0, BGMODE `$10`) only seeds the
initial shadow; the HDMA overrides `$2105` per scanline during active display.
Empirically confirmed by the `title-render` trace scenario
(`getState().ppu.bgMode == 7` at the lower scanlines, live projective Mode-7
matrix; see `trace-harness/scenarios/title-render/` and `graphicsassets.md`
§11.2 / §15.6).

> The lone `$41` (still Mode 1) BGMODE write at `yi/Banks/Bank17.asm:2107`
> (`CODE_17906D`) is the **post-reset high-score-display** variant of the title
> code, not the normal rotating-island title — ignore it for this screen.

### Overworld map — Mode 1 (`$01`)

`CODE_gm20_prepare_overworld` (`$17:A58E`, `yi/Banks/Bank17.asm:4558`) does
`LDX #$28 : JSL CODE_init_scene_regs`. `X=$28` → word `$017C` = **row 19** =
BGMODE `$01` (plain Mode 1, all 8x8 tiles, BG3-priority off), main-screen `$17` =
BG1+BG2+BG3+OBJ. The running loop `CODE_gm22_overworld` (`$17:B3CD`) does not
rewrite BGMODE.

### In-level (most common) — Mode 1 (`$69`)

The standard level path picks the row through a double indirection:

```
LevelMode (header field $0146)
  → DATA_levelmode_index[mode]            ; yi/Banks/Bank01.asm:6009
  → X
  → DATA_scene_layout_indices[X]          ; byte offset → row
  → DATA_scene_register_layout row        ; byte +$05 = BGMODE
```

(`yi/Banks/Bank01.asm:6235`: `LDY LevelMode : LDX DATA_levelmode_index,y :
JSL CODE_init_scene_regs`.) LevelMode `$00` is the most common (53 of 222 levels;
distribution in `bg23rendering.md` §1) → `DATA_levelmode_index[0]=$04` → word
`$0028` = **row 2** = BGMODE `$69`.

So a normal gameplay frame is **Mode 1**:

- **BG1 — 4bpp** (8x8 tiles): the Map16 foreground playfield.
- **BG2 — 4bpp** (16x16 tiles): background scenery.
- **BG3 — 2bpp** (16x16 tiles, **high-priority** via BGMODE bit 3): the HUD /
  status overlay.

This holds for essentially every normal level: rows 2–21 of
`DATA_scene_register_layout` all carry BGMODE `$69`. The level modes that leave
Mode 1 are the handful documented in `bg23rendering.md` §3 — LevelMode `$03`
(Mode 2, offset-per-tile BG3), `$09` (Mode 7, Raphael's circular arena), and
`$0A` (Mode 0, Kamek autoscroll — the one level where BG1 is 2bpp). Note also
that `irq_normal_level_mode` rewrites BGMODE/TM each frame at scanline `$DC`, so
the values above are the **live in-level-area** config (post-IRQ), which for
LevelMode `$00` is the same `$69`/`$17`.

---

## 4. Cross-references

- `bg23rendering.md` §3 — exhaustive per-LevelMode in-level BGMODE/TM/TS/SC/NBA
  table; §4 — the per-scanline IRQ reconfiguration.
- `renderingpipeline.md` §1 — the per-layer "where pixels come from" model.
- `graphicsassets.md` §11.2 — Mode-7 title island tile format.
- `enginecore.md` §4 — NMI/IRQ flow that re-applies the register mirrors.
- `mchip.md` §3.10–3.12 — SuperFX Mode-7 / OAM / rotation rasterisers.
- Key data tables: `DATA_scene_register_layout` (`$00:BBEA`),
  `DATA_scene_layout_indices` (`$00:BBAF`), `DATA_reg_mirror_mapping`
  (`$00:BBDB`), `DATA_levelmode_index` (`$01:AF80`).
