# YI BG/FG rendering pipeline reference

How background and foreground tile layers (BG1 / BG2 / BG3) get from
ROM/SRAM/LDB into pixels on screen. Complements:

- `docs/leveldataengine.md` §2.1 — the BG1/BG2/BG3/OAM **layer model**
  (what each layer is, who *loads* it). This doc is the **rendering**
  side: who configures the PPU, who runs per-scanline tricks, and
  where the SuperFX participates.
- `docs/enginecore.md` §4 (NMI/IRQ flow), §5 (palette loader), §6
  (gfx loader), §8 (DMA queue), §9 (fade).
- `docs/bossengine.md` §4 — the **canonical HDMA channel reference
  table** (boss code uses every channel; the same table applies to
  normal levels too).
- `docs/levelloader.md` §1 stage 4 — gm$0C level-data staging.
- `docs/mchip.md` §3.10-3.12 — SuperFX rasterisers (Mode-7, sprite
  OAM packing, rotation/zoom).

Out of scope here: sprites/OAM (see `spritestateengine.md`), Map16
stamping into LDB (see `leveldataengine.md`), Mode-7 boss rendering
(see `bossengine.md` §4.3), special effects.

---

## 1. The "where do pixels come from" map

There are seven independent contributors to a given on-screen pixel
in a normal in-level frame. Each is gated by different state.

| Contributor | Source data | Configured by | Per-frame work | Per-scanline work |
|---|---|---|---|---|
| **BG1 tilemap (foreground)** | VRAM tilemap built from LDB (`$7F:8000`) Map16 IDs → sub-tile-info from `$4C:33F2+` Map16 page table | `init_scene_regs` writes BGMODE/BG1SC/BG12NBA/TM ($00:BDA2) | Column-stream new BG1 tilemap to VRAM as camera scrolls (Bank10/Bank11) | None (PPU draws it) |
| **BG2 tilemap (parallax decoration)** | Pre-rendered tilemap incbin (level-header-driven) | `init_scene_regs` writes BG2SC + TM bit 1 | BG2HOFS/VOFS scroll mirrors → PPU each NMI | Sometimes HDMA scroll-mod (channel 4) |
| **BG3 tilemap (deep parallax)** | Pre-rendered tilemap incbin + optional SuperFX-computed effects | `init_scene_regs` writes BG3SC + BG34NBA + TM bit 2 | BG3HOFS/VOFS scroll mirrors → PPU each NMI | HDMA channels 3/4/7 modulate scroll; channels 1/2 stream COLDATA gradient to `$2132` per scanline |
| **OBJ (sprites)** | OAM mirror buffer ($7E:0200+) populated by 65816 sprite engine + SuperFX OAM packers | `init_scene_regs` writes OBJSEL + TM bit 4 | OAM mirror → DMA to PPU OAM each NMI | None |
| **Color math (add/subtract)** | CGADSUB ($2131) selects layers; CGWSEL ($2130) selects fixed-color vs subscreen; COLDATA ($2132) supplies the fixed BGR | `init_scene_regs` writes CGWSEL/CGADSUB rows; **per-frame NMI/IRQ rewrites them** (see §3) | NMI tail writes COLDATA mirror → `$2132` | IRQ rewrites CGWSEL when crossing the status-bar split; HDMA streams COLDATA per scanline (sky gradient) |
| **Window masking** | W12SEL/W34SEL/WOBJSEL ($2123-$2125) + WH0-WH3 ($2126-$2129) + TMW/TSW ($212E/$212F) | `init_scene_regs` writes the four window-related mirrors | None usually | HDMA channel 5 streams Window1 left edge to `$2126` (fog cutouts, etc.) |
| **Brightness / force-blank** | INIDISP ($2100) | `init_scene_regs` zeroes the mirror | NMI writes brightness mirror → `$2100` each frame; fade routine ticks the mirror | IRQ 0 force-blanks above the level area; IRQ 1 restores brightness |

The "what's actually on screen at pixel `(x, y)`" answer is: the PPU
composites BG1+BG2+BG3+OBJ per the TM/TS/CGADSUB/CGWSEL state
**active for that scanline**, plus the COLDATA fixed color **active
for that scanline**. Both can be different at scanline 8, scanline
$D8, and scanline $DC.

### 1.1 BG1 character tileset and palette can change mid-level

The BG1 row above implies one tileset/palette per level (loaded from the
header). That is the *initial* state only. A family of 16 **Graphic/Palette
Changer** special sprites (IDs `$1BA-$1C9`) overwrite the live BG1 tileset
**or** palette when the camera reaches them, and the new value persists for
the rest of the level (or until the next changer). Only BG1 is affected --
BG2/BG3/OBJ are untouched. The change is **stateful and temporal**, not
spatial: there is no per-region table in the cart, so "this half of the level
looks different" is purely a consequence of the player crossing one sprite
once. (For example, in 4-4 the fort half runs on a different BG1 tileset than
the approach.)

All 16 IDs share one Init handler, `CODE_init_palette_spr` at `$03:D55B`
(dispatched from `DATA_special_sprite_inits` at `$03:D46F`). These special
sprites have no Main -- they apply their effect on spawn and self-remove via
`CODE_remove_special_spr`. The handler:

- **Selects tileset vs palette** by the parity of `$7960` (sprite direct-page
  slot `$00`): carry-clear -> tileset swap, carry-set -> palette swap. A single
  changer alters one or the other, never both.
- **Computes the new index** as `$0C04,y - 1` (the changer's stored parameter
  minus one). Across the 16 IDs the result spans `$0-$F` (i.e. `id - $1BA`),
  matching the 16-entry tileset/palette tables.
- **Is idempotent**: if the computed index already equals the current header
  field, it does nothing and just removes the sprite.

**Tileset swap** writes the new index to the BG1 tileset header field
`!RAM_YI_Level_LevelHeaderBG1TilesetLo` (`$0136`), then calls `CODE_03D5E4`,
which re-requests every active sprite's graphics (`CODE_03AF0D` per live slot)
and dirties the whole sprite dyntile in-use bitfield (`$7ECC = $FFFF`) so the
sprite tiles are re-staged. That header field is the index the level gfx loader
(`load_level_gfx`, see `enginecore.md` §6) runs through `DATA_bg1_tileset_files`
(`$00:AF39`, 16 rows x 3 bytes, indexed `tileset * 3`) to pick the **three** BG1
character compressed-gfx files -- so the swap ultimately changes which three
files occupy BG1 char VRAM. (World 6 substitutes `DATA_bg1_dark_tileset_files`.)

**Palette swap** writes the new index to the BG1 palette header field
`!RAM_YI_Level_LevelHeaderBG1PaletteLo` (`$0138`) and applies it immediately
in-handler: it indexes `DATA_bg1_palette_ptrs` (`$00:B874`) by the new value and
rewrites the BG1 CGRAM block in the SuperFX palette staging buffers
(`$7020xx` / `$702Dxx`), then removes the sprite.

So the two paths are asymmetric: a palette change takes effect inside the
handler, while a tileset change only updates the header field (plus the sprite
gfx re-request) and relies on the BG1 gfx loader to bring in the new character
tiles. See `spritestateengine.md` §4 for where these special sprites sit in the
dispatch.

---

## 2. The 22-row scene register layout (THE table)

Almost every PPU register that controls layer visibility, color math,
and window masking gets its **initial** value from a single table:
`DATA_scene_register_layout` at `$00:BBEA`. 22 rows × 20 bytes,
selected by the level's **LevelMode** field (level-header byte 10,
5 bits — see `levelloader.md` §2 LevelMode dispatch).

### 2.1 Table family

| Label | Address | Shape | Role |
|---|---|---|---|
| `DATA_scene_layout_indices` | `$00:BBAF` | 22 × `dw` | Word-offset index into the layout table, stride 20. `scene_layout_indices[LevelMode] = scene_register_layout + LevelMode*20`. |
| `DATA_reg_mirror_mapping` | `$00:BBDB` | 15 × `db` | The 15 PPU register low-bytes corresponding to mirror bytes 0..14 in the WRAM block at `$7E:095E-$096C`. See §2.3. |
| `DATA_scene_register_layout` | `$00:BBEA` | 22 × 20 B | The actual per-LevelMode preset. See §2.2. |

The row stride is 20 bytes but only the first 5 bytes are "preamble"
state — bytes 5..19 are the 15 register mirrors copied to WRAM and
then to PPU.

### 2.2 Row layout (per LevelMode)

| Offset | Goes to | Purpose |
|---|---|---|
| `+0` | `$011C` (`r_interrupt_mode`) | Interrupt-mode index — selects the NMI handler (`DATA_interrupt_mode_nmi_handlers`) **and** the V=`$DC` IRQ-VRAM-transfer routine (`irq_vram_tx_routines`; see §3.3). The preamble byte is *processed* into `$011C` during scene-load, not copied verbatim — runtime-verified as `$02` (`irq_normal_level_mode`) for every normal in-level LevelMode. |
| `+1` | `$0126` (IRQ kind) | Secondary IRQ-kind byte. The V=`$DC` IRQ-routine dispatch keys off `$011C`, **not** `$0126` (corrected per runtime capture — see `bg23rendering.md §4`). |
| `+2` | `$012D` (SuperFX SCBR mirror) | GSU screen-base register. |
| `+3` | `$012E` (SuperFX SCMR mirror) | GSU screen-mode register. |
| `+4` | flag | If non-zero, runs the "scroll background-color down by one CGRAM row" trick used by COLDATA-mode-7 backdrops. |
| `+5..+19` | `$7E:095E..$096C` | 15-byte mirror block (see §2.3). |

### 2.3 The 15-byte mirror block

`CODE_init_scene_regs` (at `$00:BDA2`) copies bytes 5..19 of the
selected row into WRAM `$7E:095E..$096C`, then walks
`DATA_reg_mirror_mapping` from `$0E` down to `0` and stores each
mirror byte into the corresponding `$21xx` PPU register via
indirection (`STA ($00),y` with `$00..$01 = $2100`):

| Mirror offset | `DATA_reg_mirror_mapping[i]` | PPU register | Symbolic name |
|---|---|---|---|
| `$095E` | `$05` | `$2105` BGMODE | `!REGISTER_BGModeAndTileSizeSetting` |
| `$095F` | `$07` | `$2107` BG1SC | `!REGISTER_BG1AddressAndSize` |
| `$0960` | `$08` | `$2108` BG2SC | `!REGISTER_BG2AddressAndSize` |
| `$0961` | `$09` | `$2109` BG3SC | `!REGISTER_BG3AddressAndSize` |
| `$0962` | `$0B` | `$210B` BG12NBA | `!REGISTER_BG1And2TileDataDesignation` |
| `$0963` | `$0C` | `$210C` BG34NBA | `!REGISTER_BG3And4TileDataDesignation` |
| `$0964` | `$23` | `$2123` W12SEL | `!REGISTER_BG1And2WindowMaskSettings` |
| `$0965` | `$24` | `$2124` W34SEL | `!REGISTER_BG3And4WindowMaskSettings` |
| `$0966` | `$25` | `$2125` WOBJSEL | `!REGISTER_ObjectAndColorWindowSettings` |
| **`$0967`** | `$2C` | **`$212C` TM** | **`!REGISTER_MainScreenLayers`** |
| **`$0968`** | `$2D` | **`$212D` TS** | **`!REGISTER_SubScreenLayers`** |
| `$0969` | `$2E` | `$212E` TMW | `!REGISTER_MainScreenWindowMask` |
| `$096A` | `$2F` | `$212F` TSW | `!REGISTER_SubScreenWindowMask` |
| **`$096B`** | `$30` | **`$2130` CGWSEL** | **`!REGISTER_ColorMathInitialSettings`** |
| **`$096C`** | `$31` | **`$2131` CGADSUB** | **`!REGISTER_ColorMathSelectAndEnable`** |

The TM (`$0967`), TS (`$0968`), CGWSEL (`$096B`), CGADSUB (`$096C`)
bytes are the **headline knobs** for "which layers are visible" and
"is color math on". Every YI scene's preset is a row in
`scene_register_layout`.

### 2.4 init_scene_regs tail

After the mirror→PPU copy, `init_scene_regs` also:

1. Zeroes `!RAM_YI_Global_HDMAEnable` (`$0D40` mirror of `$420C`) —
   per-frame HDMA enable gets re-armed by the level loader / boss
   init via `hdma_and_gradient_init`.
2. Zeroes `!REGISTER_BG4AddressAndSize` (`$210A`) — BG4 is never used
   in level rendering.
3. Zeroes `!RAM_YI_Global_BGWindowLogicSettings` + `$2121` mirror.
4. Sets `!RAM_YI_Global_OAMSizeAndDataAreaDesignation = $02` and
   writes `$2101` accordingly (OBJ tile-size + name-base preset).
5. Zeroes `!REGISTER_InitialScreenSettings` (`$2100` INIDISP).

The brightness is then driven each frame by the NMI handler from
the `ScreenBrightness` mirror (see `enginecore.md` §4.3, §9).

### 2.5 Callers — the "load scene" sites

`init_scene_regs` runs once per scene-load, not per frame.
Per `--callers`:

- `CODE_gm00_ninpresents_prep` — Nintendo Presents logo.
- `CODE_gm_load_title_screen` — title screen.
- `CODE_gm05_load_cutscene` — story cutscenes.
- `CODE_gm13_prepare_retry_screen` — retry prompt.
- `CODE_gm1b_load_credits` — credits.
- `CODE_gm20_prepare_overworld` — world map.
- `CODE_gm2a_load_bonus_game` — bonus rooms.
- `CODE_gm2e_main_bandit_minigame` — bandit minigame.
- `CODE_gm38_load_intro_cutscene` — intro cutscene.
- `CODE_gm3f_load_game_over` — game-over screen.
- `CODE_load_levelmode_09_settings` — Raphael Mode-7 boss.
- `CODE_load_levelmode_0A_gfx` — Kamek autoscroll.
- `CODE_retry_setup_shared` — shared retry path.
- Several Bank17 worldmap variants.

For **normal in-level loads** (LevelMode `$00`-`$08`), the gm$0C
chain runs `init_scene_regs` indirectly via the `.load_scene`
sub-block in `gm0c_level_fadein_and_name`. The level header's
LevelMode byte indexes `DATA_scene_layout_indices` to pick the row.

### 2.6 Trace-harness gotcha (sprite-render learned this the hard way)

When a trace scenario substitutes a synthesized level header, the
level's intended LevelMode might not be the one whose PPU mirrors
end up on the live PPU. Per `trace-harness/scenarios/sprite-render/patch.asm`
lines 45-69, the sprite-render scenario observed that PPU mirrors
came from **row 5** (LevelMode `$05`), not the header's row 3 — the
header's LevelMode wasn't latched into the path that `init_scene_regs`
read by the time it ran during boot. The scenario patches **both
rows 3 and 5** of `DATA_scene_register_layout` to force the desired
TM/TS/BGMODE/CGWSEL/CGADSUB values regardless of which row the
runtime ends up picking.

This isn't a bug in YI — it's a consequence of running
`init_scene_regs` during boot (with a default LevelMode) and then
again later when our test-level header overrides the mode but the
PPU state from boot is still partly in effect. The general lesson:
**LevelMode controls which row is read, but the row's mirror values
only land on the PPU at the moment of the read**. Late changes to
LevelMode don't repaint the PPU.

---

## 3. Per-scanline reconfiguration (the status-bar split)

The PPU state set up by `init_scene_regs` is the state for the
**level area** of the screen. The status bar at the top of the
screen needs different state — different BG layers visible (so the
status-bar BG3 score/timer tiles show up over a blank backdrop),
different brightness behavior (often force-blank during VRAM
transfer to the status-bar region).

This is implemented as a three-stage V-IRQ chain. See
`enginecore.md` §4.6 for the dispatch table; the relevant
register-rewriting per scanline:

### 3.1 IRQ 0 at V=$08 (`irq_default` head)

Force-blank by writing INIDISP = `$8F` (max brightness, but with
force-blank bit set so the screen is blanked above scanline 8).
Re-arms V-IRQ to fire at scanline `$D8`. No layer config changes.

### 3.2 IRQ 1 at V=$D8 (transition into level area)

Restores INIDISP from `ScreenBrightness` mirror — undoing the
force-blank, letting the level area render.

When stage-intro flag `$0121 != 0`, also dispatches the level-name
overlay routine via `DATA_level_intro_irq_routines` — this can
chain into `render_stage_intro_level_name` which sets up the GSU
to draw the "1-1 Make Eggs, Throw Eggs"-style title via
`FXCODE_09E92F`. See `enginecore.md` §4.7 for the GSU register
setup.

### 3.3 IRQ 2 at V=$DC (VRAM transfer + per-mode register rewrite)

Force-blank again so VRAM is safe to touch, then dispatches via
`irq_vram_tx_routines[$011C]` to the per-scene routine:

| `$011C` | Routine | Effect on BG/FG config |
|---|---|---|
| `$00` | `set_v_irq_return` | none (Nintendo logo) |
| `$02` | **`irq_normal_level_mode`** | **rewrites BGMODE, BG1SC, BG3SC, BG12NBA, BGWindowLogicSettings, MosaicSize+BGEnable, TM, TMW, WOBJSEL, CGWSEL, BG1HOFS, BG1VOFS, BG2HOFS, BG2VOFS, BG3HOFS, BG3VOFS** |
| `$04` | `irq_offset_per_tile_levels` | per-tile-offset BG3 modulation (1-7 secret, 6-4 spike ceiling) |
| `$06` | `set_v_irq_return` | none (Island scenes) |
| `$08` | `irq_story_cutscene_credits` | rewrites the cutscene/credits BG state |
| `$0A` | `irq_raphael_the_raven_boss` | Mode-7 boss reconfiguration |
| `$0C` | `set_v_irq_return` | none (world map) |
| `$0E` | `set_v_irq_return` | none (bonus/bandit) |

**`irq_normal_level_mode` is the most-commonly-running IRQ for
in-level frames** and it heavily reconfigures the PPU between the
status-bar area and the level area. Per `xref` (`!REGISTER_*`
writes): BGMODE, BG1SC, BG3SC, BG12NBA, TM, TMW, MosaicEnable,
WOBJSEL, CGWSEL, every BG1/BG2/BG3 scroll register, and
WindowLogicSettings.

**This is why patching `DATA_scene_register_layout` doesn't fully
hide BG2/BG3.** The scene table sets the initial register values,
but `irq_normal_level_mode` rewrites BGMODE, TM, and CGWSEL **every
frame** at scanline `$DC` based on per-frame WRAM mirror state. To
suppress backgrounds visually, you need to patch BOTH the scene
table AND the per-frame mirrors the IRQ reads from
(`!RAM_YI_Global_MainScreenLayers` at `$0967`, etc.) — or patch the
IRQ routine itself.

---

## 4. Color math: when it's on, what it touches

Color math is the SNES's per-pixel BGR add/subtract feature, gated
by:

- **CGWSEL** (`$2130`) — selects subscreen vs fixed color as the
  "B" operand, plus per-region force-on/off flags.
- **CGADSUB** (`$2131`) — selects which layers (BG1/BG2/BG3/OBJ/
  backdrop) participate in the math; selects add vs subtract;
  selects half-result vs full-result.
- **COLDATA** (`$2132`) — write-only register taking 5-bit
  R, G, or B components for the fixed-color operand.

### 4.1 Per-scene baseline

`DATA_scene_register_layout` mirror bytes `$096B` (CGWSEL) and
`$096C` (CGADSUB) supply the initial values per LevelMode. Color
math is OFF for most LevelModes ($0=$1=$2 typically have CGWSEL=0,
CGADSUB=0); some bonus/cutscene modes turn it on.

### 4.2 Per-frame NMI tail

`CODE_nmi_normal_level` does NOT touch CGADSUB or CGWSEL. It does
write COLDATA via the COLDATA mirror at `$0948`. The COLDATA mirror
is updated by `init_scene_regs` (when the row's preamble byte +4 is
non-zero, the routine ROTATES the palette down to make room for a
backdrop-color row at CGRAM index 0) and by the **fade pipeline**
(`enginecore.md` §9).

### 4.3 Per-IRQ rewrite

`irq_normal_level_mode` writes CGWSEL (`!REGISTER_ColorMathInitialSettings`)
each frame at scanline $DC. So even if you set CGWSEL=0 in the
scene table, the IRQ will replace it after the status bar. The
value comes from the mirror at `$096B` — which IS readable, but the
IRQ has its own logic to choose what to write (it doesn't blindly
DMA-copy the mirror; check the source for the actual decision).

### 4.4 HDMA-driven COLDATA stream

Two HDMA channels (1 and 2) are typically armed at level-load by
`hdma_and_gradient_init` (`$01:D5B3`) to stream a 256-entry
gradient table to `$2132` (COLDATA) per scanline. This is what
creates the per-scanline sky gradient (top-of-screen tint changes
smoothly down the screen). The gradient table is:

1. **Computed by the SuperFX** in `FXCODE_0890E7`, which writes the
   256-entry table to `$70:5800`.
2. **Copied to WRAM** at `$7F:56DE` by a DMA queued in the same init.
3. **Streamed to `$2132` per scanline** by HDMA channels 1+2 (split
   for the high/low halves of the screen).

The full HDMA channel allocation is documented in `bossengine.md`
§4.1 — that table applies to normal levels too, since
`hdma_and_gradient_init` is shared. Quick summary:

| Channel | Destination | Drives |
|---|---|---|
| 1 | `$2132` COLDATA | BG3 gradient (top half) |
| 2 | `$2132` COLDATA | BG3 gradient (bottom half) |
| 3 | `$210F` BG3HOFS | wavy/sun BG3 horizontal mod |
| 4 | `$2110` BG3VOFS | wavy/sun BG3 vertical mod |
| 5 | `$2126` WH0 | window-mask effects (fog, etc.) |
| 6 | reserved | boss-only |
| 7 | `$210F` BG3HOFS | sun/mist additional mod |

`!RAM_YI_Global_HDMAEnable` (the `$420C` mirror) gates which
channels actually fire — set per-scene by `init_scene_regs`
(zero) + the post-init level-load chain (re-arm bits per level).

---

## 5. SuperFX involvement in BG/FG

The SuperFX (GSU-2) is YI's headline feature, but it does **NOT
render the BG1 foreground tilemap, BG2 parallax, or BG3 standard
parallax**. Those layers are pure tile-engine rendering — the
65816 builds the VRAM tilemap and the PPU draws it.

### 5.1 What the GSU does NOT do for BG/FG

- **Does not stamp Map16 IDs into LDB.** That's pure 65816 (Bank13
  handlers, see `leveldataengine.md` §3.8).
- **Does not write VRAM tilemap bytes directly.** The 65816
  column-streamer (Bank10/Bank11) reads Map16 page-data words from
  `$4C:33F2+` and DMAs them to VRAM.
- **Does not write BG2/BG3 tilemap.** Those are pre-rendered
  incbins copied to VRAM at level-load by `load_level_gfx`
  (`enginecore.md` §6).
- **Does not control the PPU layer-visibility registers** (TM, TS,
  BGMODE). Those are pure 65816 (init_scene_regs + IRQ
  rewrites).

### 5.2 What the GSU DOES do for BG3 + color-math effects

- **BG3 gradient generation** — `FXCODE_0890E7` generates the
  256-entry COLDATA gradient table per frame; HDMA streams it to
  `$2132` per scanline. **Without the GSU running, the sky has no
  gradient.**
- **Hookbill fog cinematic** — driven by the boss-sprite state
  machine (`CODE_018025+` in Bank01: `hookbill_init_fog` →
  `_fog_left` → `_fog_stay` → `_fog_fade`), which runs a per-line
  SuperFX raster (refs `FXCODE_089208` + `FXCODE_08AA7F`). Note:
  `FXCODE_08AA7F` is `CODE_ram_byte_copy` — a generic byte-copy the
  raster *uses*, **not** a dedicated BG3 re-renderer. See
  `bossengine.md §2.2 / §4.2` and `bg23rendering.md §6.6`.
- **Per-frame fog column advancement** — `FXCODE_089208` updates
  the fog column pointer + density.
- **Sun position HDMA** — `FXCODE_08EBB5` computes per-scanline
  sun-position HDMA tables (see `setup_bg3_sun_hdma`).
- **Stage-intro level-name overlay** — `FXCODE_09E92F` walks the
  per-level name string and streams it as tiles into the BG3
  tilemap (`enginecore.md` §4.7).
- **Boss BG3 effects** — `FXCODE_08D486` renders the BG3 plank for
  the moving-platform sprite family (NorSpr $05E/$05F); various
  boss-specific BG3 rasterisers exist in Bank08-0B (see
  `mchip.md` §3.10).
- **Map16 page-data lookups (for COLLISION, not rendering)** — the
  GSU's `BGUNIT_READ` chain reads `bg_type_table` (`$0A:BB12`) to
  decode collision shape per Map16 page. This is what Yoshi's
  physics engine consults; the rendering side never reads
  `bg_type_table`. See `mchip.md` §3.3.1.

### 5.3 The boundary, summarised

| Layer | 65816 rendering | GSU contribution |
|---|---|---|
| BG1 (foreground) | full | none |
| BG2 (parallax) | full | none for vanilla; per-effect rasterisers exist for special scenes |
| BG3 (deep parallax) | tilemap upload, scroll | gradient table, special-effect re-rendering, level-name overlay |
| OBJ (sprites) | OAM mirror buffer fill | sprite OAM packing, rotation/zoom rasterisers, scaling |
| Color math | CGADSUB/CGWSEL writes | COLDATA gradient table (driven via HDMA) |

If you wanted to hide all "background-ish" pixels, the GSU is only
load-bearing for **BG3 effects + COLDATA gradient** — for plain BG1
and the BG2 parallax, only 65816 + PPU state matter.

---

## 5.4 BG2 tile-index wraparound + the scroll-as-occlusion pattern

A BG2 tilemap entry's tile field is 10-bit (0..$3FF) and each 4bpp
tile occupies 32 bytes, so the tile-index space addresses
`$3FF * $20 = $7FE0` ≈ 32 KB. With BG2 char base typically set at
`$E000` (BG12NBA upper nibble = 7), tile indices above ~`$100`
**wrap past `$FFFF` back to `$0000`**. The PPU performs this wrap
naturally — it just reads from the wrapped address.

YI levels deliberately use this wrap to share tile graphics across
layers. A single BG2 tilemap entry can reference char data sitting in:

- A BG2-categorised chunk (the "intended" tile)
- A BG1-categorised chunk (BG2 borrowing BG1's hill / cloud
  graphics, e.g. 1-2)
- A DIRECT-loaded HUD/font region (the cart's "filler" pattern —
  tile `$EE` in 1-2's BG2 reads from the HUD font region at
  `$FDC0`)
- Uninitialised VRAM (renders as color-0)

The cart's `BG2VOFS` mirror is re-written every frame from camera
state by the level-mode-specific parallax math. The Y position of
BG2 on-screen is chosen so that **only the tilemap rows whose
tile-indices hit BG2-categorised chunks are inside the visible
area**. The rows whose indices wrap into BG1 / HUD / uninit are
scrolled off the top or bottom of the screen — the scroll is the
occlusion mechanism. This is BG2-specific in practice: BG3's
tilemap convention keeps tile-indices within the BG3 char chunks,
and BG1's char chunks cover its full tile-index range.

---

## 6. Why hiding BG2/BG3 cleanly is hard

Synthesizing all of the above: a trace scenario or hack that wants
to suppress backgrounds and show only BG1+OBJ has to defeat **at
least four independent state sources**, several of which run every
frame:

1. **PPU TM/TS state** (set by `init_scene_regs` from the scene
   table row). Patchable, but only the row corresponding to the
   *actual* LevelMode the runtime ends up reading — and per
   sprite-render's gotcha, that can be a different row than the
   header's LevelMode if the read happens during boot before the
   header is staged.
2. **IRQ per-frame rewrite** (`irq_normal_level_mode` rewrites TM
   and CGWSEL at scanline `$DC` from the WRAM mirror). Patching
   the scene table alone leaves the IRQ rewriting the values back
   in. Mitigations: also overwrite the WRAM mirror at `$0967` each
   frame from Lua (what `sprite-render/trace.lua` does), or NOP
   the IRQ register writes themselves.
3. **HDMA-driven COLDATA + scroll modulation**. Even with TM/TS
   suppressing BG3 layer visibility, the COLDATA gradient HDMA
   still writes per-scanline color values to `$2132` — if any
   color-math source uses fixed-color, those gradient values can
   still tint the screen. Disable by clearing
   `!RAM_YI_Global_HDMAEnable` (`$0D40` mirror of `$420C`) or by
   zeroing the gradient table.
4. **Status-bar split state**. Even with the level area suppressed,
   the IRQ 0 force-blank still hides scanlines `0..7`, and the
   stage-intro overlay (if active) writes name-text tiles into BG3
   regardless of TM. Per `sprite-render/trace.lua`'s sub-screen
   override: also continuously stomp `$7E:0968` (`SubScreen`
   mirror) and `$7E:094A` (HDMA enable mirror) each frame to
   suppress any per-frame writes the IRQ might be doing.

Concretely, `sprite-render/patch.asm` patches the scene table rows
3 *and* 5, AND its `trace.lua` writes-overrides
`$7E:0967`/`$7E:0968`/`$7E:094A` each endFrame. That combination
yields a clean sprite-only canvas; no single intervention does it
alone.

---

## 7. Cross-references

| Topic | Where |
|---|---|
| BG1/BG2/BG3 layer roles | `leveldataengine.md` §2.1 |
| Map16 ID → VRAM tile data path | `leveldataengine.md` §3.4.5 (page-table layout) |
| Map16 collision encoding (GSU side) | `mchip.md` §3.3.1, §3.3.2 |
| Palette pipeline (CGRAM mirror → PPU) | `enginecore.md` §5 |
| Graphics file loader (LZ16 → VRAM) | `enginecore.md` §6 |
| NMI per-frame work | `enginecore.md` §4.3 |
| IRQ 3-phase scanline stepping | `enginecore.md` §4.6 |
| Stage-intro overlay (GSU + BG3) | `enginecore.md` §4.7 |
| HDMA channel allocation table | `bossengine.md` §4.1 |
| Hookbill fog (HDMA + GSU cinematic) | `bossengine.md` §4.2 |
| GSU sprite OAM packing | `mchip.md` §3.11 |
| GSU rotation/zoom rasterisers | `mchip.md` §3.12 |
| LevelMode field + scene-load chain | `levelloader.md` §1 stage 4 |
| DMA queue management | `enginecore.md` §8 |
| Fade routines (ScreenBrightness) | `enginecore.md` §9 |
