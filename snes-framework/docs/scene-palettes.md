# YI palette → CGRAM loading per scene

How colors get from the cart's **master palette blob** into **CGRAM** for each
commonly-used screen — and therefore how to map an edit of the blob (or of an
intermediate buffer) to a visible color change.

This is the **palette/CGRAM** companion to `scene-bgmodes.md` (which does the same
whole-game, per-screen treatment for the BG *mode*). Where that doc answers "what
PPU mode is this screen in", this one answers "where did this screen's colors
come from, and what would I patch to change them."

| For the mechanism of… | See |
|---|---|
| The palette interpreter internals (entry format, glitch note) | `enginecore.md` §5 |
| Per-frame animated palette engine | `enginecore.md` §5.6, `graphicsassets.md` §6 |
| Fade pipeline (brightness + color rescale) | `enginecore.md` §9 |
| Sprite (OBJ) palette rows 8–15 | `graphicsassets.md` §5.7 |
| BG1 Map16 `pal` field → BG palette row | `graphicsassets.md` §4.1 |
| Mid-level BG1 palette swap (Changer sprites) | `renderingpipeline.md` §1.1 |
| PPU BG mode per scene | `scene-bgmodes.md` |
| Color math / COLDATA (not CGRAM) | `renderingpipeline.md` §4 |

> **Scope.** This covers the *common* screens a player sees constantly: in-level
> gameplay, the overworld map, the title screen, story cutscenes + the storybook
> intro, the Nintendo-Presents boot logo, and the pause overlay. The transient
> screens (retry, game-over, bonus game, bandit minigame, credits, Kamek
> autoscroll LevelMode `$0A`, Raphael Mode-7 `$09`) use the same machinery with
> their own program index — they're noted in §2 but not detailed.

---

## 1. The universal pipeline

Every screen ends at the same place: a **512-byte CGRAM mirror in SRAM**, which
the NMI DMAs to PPU CGRAM each frame. Screens differ only in *which palette
program* fills that mirror and *which CGRAM rows* the program touches.

```
master palette blob                palette program              CGRAM mirror (SRAM)        PPU
$5F:A000 (= $3F:A000 = PC $1FA000)  DATA_scene_palette_layout    $70:2000 (live, 256 words) ──NMI DMA──► CGRAM $2122
  └ BGR-15 color words      ──►    walked by load_palettes ──►  $70:2D6C (fade base mirror)            (during force-blank)
  └ per-screen pointer tables       (CODE_00BA7A)
```

### 1.1 The four moving parts

| Part | Address | Role |
|---|---|---|
| **Master palette blob** | `DATA_master_palette_rom_blob` `$5F:A000` (LoROM view `$3F:A000`, **PC `$1FA000`**) | All stored colors, as BGR-15 words (`0bbbbbgggggrrrrr`). Every pointer/offset below is **relative to this base**. |
| **Palette program** | `DATA_scene_palette_layout` `$00:B78A` | A variable-length list of 4-byte copy commands, `$FFFF`-terminated. Multiple programs are packed back-to-back; a screen picks one by its **start index X** (§1.3). |
| **Live CGRAM mirror** | `!s_cgram_mirror` = `$70:2000` (256 words = colors `$00`–`$FF`) | The staging buffer the NMI DMAs to PPU CGRAM. Color N is at byte `$70:2000 + N*2`; the OBJ half (colors `$80`–`$FF`) starts at `$70:2100`. |
| **Fade base mirror** | `$70:2D6C` (also 256 words) | A second copy `load_palettes` writes in parallel. The fade engine (`enginecore.md` §9) rescales **from this base** into the live mirror, so it survives brightness fades. |

### 1.2 The copy-command format (one program entry)

Each entry is 2 words (4 bytes); the interpreter `load_palettes` (`CODE_00BA7A`)
walks them:

```
word0  source       If high bit CLEAR: a literal byte offset into the blob ($5F:A000+off).
                     If high bit SET   : strip it, use the rest as an index into the
                                         pre-cached pointer slots at DP $0010,Y (§1.3).
                                         $FFFF = end of program.
word1  d.s           low byte d  = CGRAM destination, a COLOR index (byte addr = d*2)
                     high byte   = ssssLLLL :  high nibble s = number of CGRAM ROWS
                                               low nibble  L = COLORS (words) per row
```

Per entry: it copies **`s` rows of `L` colors**. The source advances continuously
across the whole entry; the destination advances by **`$20` bytes (one full
16-color palette row)** after each row. Every color is written to **both** the
live mirror `$70:2000` **and** the fade base `$70:2D6C`.

> The format prose in `enginecore.md` §5 (intro) has the two nibbles swapped; §5.2
> and the code agree with the table above — **low nibble = colors per row, high
> nibble = number of rows**.

### 1.3 The pre-cached pointer slots (DP `$10`–`$1C`)

A "high-bit-set" source doesn't read the blob directly — it reads a pointer that
the screen's **setup routine cached** into direct-page first. For an in-level
load (`load_level_palettes`, §3.1) the slots are filled from the **level-header**
palette fields via per-field pointer tables:

| Source word | DP slot | Filled from | Header field |
|---|---|---|---|
| `$8000` | `$10` | `$0130 + BackgroundColor*2` (backdrop sub-table in blob) | BackgroundColor |
| `$8002` | `$12` | `DATA_bg1_palette_ptrs` `$00:B874` (World-6: `DATA_bg1_dark_world_palette_ptrs` `$00:B8B4`) | BG1Palette |
| `$8004` | `$14` | `DATA_bg2_palette_ptrs` `$00:B8F4` | BG2Palette |
| `$8006` | `$16` | `DATA_bg3_palette_ptrs` `$00:B974` | BG3Palette |
| `$8008` | `$18` | `DATA_sprite_palette_ptrs` `$00:B9F4` | SpritePalette |
| `$800A` | `$1A` | BG1 ptr `+ $3C` (an "alternate" BG1 sub-block) | BG1Palette |
| `$800C` | `$1C` | `DATA_yoshi_palette_ptrs` `$00:BA14` | (current Yoshi color) |

Each table holds **blob offsets** (relative to `$5F:A000`). So the resolution for
one layer is: header field → table entry → blob offset → 15-ish colors → a fixed
CGRAM row. Other screens cache different pointers into the same slots (§3.2–3.6).

### 1.4 The flush to PPU

The live mirror reaches PPU CGRAM in **every** NMI that runs `CODE_00D4E5`: a
`$0200`-byte DMA from `$70:2000` → `$2122`, issued during force-blank (NMI step
5, `enginecore.md` §4.3). Nothing writes `$2122` with a literal store — CGRAM is
**only** ever loaded by this DMA (and the boot logo's own variant, §3.5). So:
**patch the mirror at `$70:2000` and the change appears on the next frame.**

---

## 2. Summary — which program each screen runs

`load_palettes` is reached through a thin per-screen wrapper that seeds the DP
pointer slots and picks the start index X:

| Screen | Setup routine | Wrapper / X | Pointer source | CGRAM rows it drives |
|---|---|---|---|---|
| **In-level gameplay** | `load_level_palettes` `$00:BA24` | falls through, **X=`$00`** | level header (BG1/2/3, sprite, Yoshi, backdrop) | all 16 (see §3.1) |
| **Overworld map** | `load_world_map_palettes` `$00:BB47` | **X=`$6E`** | per-world `DATA_00BB0B` + `DATA_00BB17` | backdrop + BG rows 0,1,2,7 from per-world ptrs; rest fixed |
| **Title screen** | `gm_load_title_screen` → `CODE_00BAEA` | **X=`$26`** | `DATA_00BAE2` / `DATA_00BAE6` (2 variants) | mostly fixed literals + 3 pointer-driven rows |
| **Story cutscene** (gm05) | Bank0F cutscene loader → `CODE_00BB05` | **X=`$50`** | all fixed blob literals | full scene, fixed palette |
| **Storybook intro** (gm38) | `gm38_load_intro_cutscene` | bespoke inline fill | BG = solid white, OBJ = blob `$5F:ED4A` | §3.4 |
| **Boot logo** (gm00) | `gm00_ninpresents_prep` → `CODE_00BB05` | **X=`$40`** | backdrop literal + common-OBJ literal | tiny; + custom per-frame ramp (§3.5) |
| **Pause overlay** | `pause_generate_tilemap` `$01:CF1F` | inline (no program) | saves live mirror, rebuilds from `$5F:A0xx` | §3.6 |
| Yoshi-color cycle | `load_yoshi_color_palette` `$00:BB70` | X=`$C2` | `DATA_yoshi_palette_ptrs` | reloads map-context + Yoshi row 13 |
| Kamek autoscroll ($0A) | `load_levelmode_0A_palettes` `$00:BB90` | X=`$D8` | header Yoshi + Sprite | sprite/Yoshi rows |
| Retry (gm13) | Bank0F retry loader → `CODE_00BB05` | X=`$4A` | fixed literals | small |
| Bonus game (gm2a) | `gm2a_load_bonus_game` → `CODE_00BB05` | X=`$94` | mixed literals + ptr slots | full scene |

> All wrappers land in the **same** `DATA_scene_palette_layout` table; the X column
> is the byte offset where that screen's program starts. The programs are listed
> in order in `yi/Banks/Bank00.asm:5530`.

---

## 3. Per-scene detail

### 3.1 In-level gameplay — `load_level_palettes`, program X=`$00`

The most important map: this is the program that paints a normal level, and the
one a recolor almost always targets. `load_level_palettes` (`$00:BA24`) first
caches the seven header pointers into DP `$10`–`$1C` (§1.3), then runs the X=0
program. Decoded, it lays the level header's colors into CGRAM like this:

| CGRAM target | Colors | Source (entry) | Driven by |
|---|---|---|---|
| Color `$00` | backdrop | `$8000` → backdrop ptr | **BackgroundColor** |
| Row 0, cols 1–15 | `$01`–`$0F` | `$8006` → BG3 ptr | **BG3Palette** |
| Rows 1–3, cols 1–11 | — | literal `$027C` | fixed common BG |
| Rows 1–3, cols 12–15 | — | `$800A` → BG1-alt ptr | **BG1Palette** (`+$3C`) |
| Rows 4–5, cols 1–15 | — | `$8002` → BG1 ptr | **BG1Palette** |
| Rows 6–7, cols 1–15 | — | `$8004` → BG2 ptr | **BG2Palette** |
| Rows 8–12, cols 1–15 | `$81`–… | literal `$01C8` | fixed common OBJ (sprite pals 0–4) |
| Row 13, cols 1–15 | `$D1`–`$DF` | `$800C` → Yoshi ptr | **Yoshi color** (OBJ pal 5) |
| Rows 14–15, cols 1–15 | `$E1`–`$FF` | `$8008` → sprite ptr | **SpritePalette** (OBJ pals 6–7) |

So the **BG-half** row assignment is fixed by the program: **BG3 → row 0, BG1 →
rows 1–5, BG2 → rows 6–7**. A Map16 sub-tile's 3-bit `pal` field (`graphicsassets.md`
§4.4) selects which of these rows an 8×8 cell uses. The **OBJ-half** map (rows
8–15) matches `graphicsassets.md` §5.7 exactly: rows 8–12 are the level-invariant
common sprite colors, row 13 is Yoshi, rows 14–15 are the per-level
SpritePalette.

**Per-frame clobbers** (things that overwrite the program's output every frame —
critical for live editing, §4):

- **Animated palette** (`enginecore.md` §5.6): if the header's AnimationPalette
  field is non-zero, one `anim_pal_*` routine re-writes a specific set of CGRAM
  rows **every frame** from a source in bank `$5F`. E.g. AnimationPalette `$01`
  re-writes colors 67–79 (BG1 row 4) — so editing those in the mirror won't
  stick; edit the animation source instead.
- **Fade** (`enginecore.md` §9): brightness fades rescale the whole live mirror
  from the `$70:2D6C` base each step.
- **Mid-level BG1 swap** (`renderingpipeline.md` §1.1): a Graphic/Palette-Changer
  sprite (`$1BA`–`$1C9`) can rewrite the BG1 CGRAM block in the staging buffers
  when the camera reaches it, re-indexing `DATA_bg1_palette_ptrs` to a new value.

### 3.2 Overworld map — `load_world_map_palettes`, program X=`$6E`

`load_world_map_palettes` (`$00:BB47`) indexes by `CurrentWorld`:
`DATA_00BB0B` (6 worlds) → DP `$10`, and `DATA_00BB17` (6 × 4 sub-pointers) →
DP `$12/$14/$16/$18`. The X=`$6E` program then loads:

- **Per-world pointers** → backdrop (color 0) + BG palette rows **0, 1, 2, 7**.
- **Fixed literals** (`$2860`, `$3F4C`, `$3DC6`) → BG rows 3–6 and the entire
  OBJ half (rows 8–15).

So to recolor a world's map, edit the blob region a `DATA_00BB17` entry points
at; to recolor the shared map sprites/UI, edit the fixed-literal regions.
(`CODE_world_map_state_07_swap_world_id` re-runs this when the displayed world
changes; the Yoshi-color cycle on the player-select map uses the X=`$C2`
sub-program, §2.)

### 3.3 Title screen — `CODE_00BAEA`, program X=`$26`

`gm_load_title_screen` calls `CODE_00BAEA` with X=`$00` or `$02` (`$02` when the
final world is unlocked or `$011A == $80` — the post-clear variant). That X picks
one of two pointer pairs: `DATA_00BAE2` = `{$293C, $297A}` → DP `$10/$12`, and
`DATA_00BAE6` = `{$2CAE, $2CCC}` → DP `$14`. The X=`$26` program is mostly **fixed
literals** (`$2860`, `$28D8`) for the cloud/logo/UI rows, plus the two
pointer-selected blobs for the variant-specific colors.

The shimmering **logo color-cycle** is a separate per-frame effect (palette-cycle
class, `graphicsassets.md` §6) layered on top of this static load — not part of
the X=`$26` program. The Mode-7 island below the split (`scene-bgmodes.md`)
resolves its 8bpp pixels through the same CGRAM, no separate palette path.

### 3.4 Story cutscenes (gm05) and the storybook intro (gm38)

**Story cutscenes** (gm05, the between-world / Bowser story pages) load via the
Bank0F cutscene loader → `CODE_00BB05` with **X=`$50`** — a program of **all fixed
blob literals** (`$2DDC`, `$30AC`, `$328C`, `$2E18`, `$346C`, `$2ECC`). There are
no header pointers; a cutscene recolor means editing those blob offsets directly.

**The storybook intro** (gm38/gm39 — "once upon a time", stork delivery) does
**not** use a palette program at all. `gm38_load_intro_cutscene` stages the scene
through the level-data machinery (translevel `$0A` → record `$38`) for its GFX and
object streams, but fills CGRAM with a **bespoke inline loop**
(`yi/Banks/Bank10.asm:10716`):

- **BG half** (rows 0–7, colors `$00`–`$7F`) ← solid white `$7FFF` (the white
  storybook pages).
- **OBJ half** (rows 8–15) ← blob `DATA_5FED4A` (`$5F:ED4A`) — the stork / Baby
  Mario / Bowser sprite colors.

The same loop also stages `DATA_5FEC4A` and `DATA_5FED4A` into the secondary
buffers `$70:2F6C`/`$70:306C`, which the gm39 phases (page-turn / spin) draw
from. So to recolor the storybook sprites, edit the blob at `$5F:ED4A` (PC
`$1FED4A`); the white background is the literal `$7FFF` in that loop, not a blob
color. `graphicsassets.md` §11.4/§11.5 has the trace-confirmed per-graphic
breakdown (the rainbow Yoshi train = one metasprite under eight OBJ palette rows).

### 3.5 Nintendo-Presents boot logo (gm00/gm01)

`gm00_ninpresents_prep` runs `init_scene_regs` (X=`$02`, Mode 1) then
`CODE_00BB05` with **X=`$40`** — a minimal program: backdrop from literal `$0130`
+ one OBJ row from the common-sprite literal `$01C8`. The "© 1995 Nintendo
presents" text itself is plotted to **BG1 by the SuperFX** (`scene-bgmodes.md`),
so its colors live in the BG rows the GSU's glyph palette references.

Two boot-specific quirks:

- **Custom color ramp.** A per-frame routine (`CODE_1088FB`) ramps live-mirror
  colors **1, 3, 6, 7** toward white (INC with wrap at `$8000`) to fade the logo
  — a bespoke effect on specific colors, not the standard fade engine.
- **Own CGRAM clear.** `gm01_boot_controller_check` (`$10:891E`) does its **own**
  force-blank `STZ` sweep of the `$70:2000` mirror (one-frame controller check)
  rather than relying on the normal flush.

### 3.6 Pause overlay — `pause_generate_tilemap` / `pause_restore_palette`

The pause menu is the clearest save/restore in the game, and directly relevant to
live editing because it **snapshots and restores the whole live mirror**:

- **On pause** (`pause_generate_tilemap`, `$01:CF1F`):
  1. Saves the entire live mirror — `$70:2000` (BG half) → `$7E:B6E0`, and
     `$70:2100` (OBJ half) → `$7E:B7E0` (`$200` bytes each).
  2. Zeroes the live `$70:2000`/`$70:2100` mirror (black).
  3. Rebuilds a minimal pause palette from **fixed blob offsets**:
     `DATA_5FA002` → color `$01`, `DATA_5FA022` → `$11`, `DATA_5FA1C8` → `$81`,
     `DATA_5FA1E6` → `$91`, `DATA_5FA204` → `$A1` (15 colors each).
- **On unpause** (`pause_restore_palette`, `$01:CF07`): copies `$7E:B6E0` →
  `$70:2000` and `$7E:B7E0` → `$70:2100`, restoring the gameplay palette verbatim.

So a live edit to the gameplay mirror is **wiped by pausing and reinstated by
unpausing** (it's saved/restored, so the edit survives the round-trip only if you
also patch `$7E:B6E0`/`$7E:B7E0`). To recolor the pause menu itself, edit the
blob at `$5F:A002 / $A022 / $A1C8 / $A1E6 / $A204`.

---

## 4. Live editing — mapping a color change

Two ways to change a color, with different reach:

### 4.1 Permanent — edit the blob, reload the scene

Patch the BGR-15 word in the blob at **PC `$1FA000 + offset`** (= `$5F:A000 +
offset` = `$3F:A000 + offset`). The change takes effect the **next time that
screen loads its palette** (re-enter the level, re-open the map, etc.) — palette
programs run once per scene-load, not per frame. To find the offset for a given
screen + layer:

| Want to recolor… | Offset = |
|---|---|
| A level's BG1 | `DATA_bg1_palette_ptrs[BG1Palette]` (`$00:B874`) — read the word, that's the blob offset |
| A level's BG2 / BG3 | `DATA_bg2_palette_ptrs` / `DATA_bg3_palette_ptrs` |
| A level's sprites | `DATA_sprite_palette_ptrs[SpritePalette]` (`$00:B9F4`) |
| Yoshi | `DATA_yoshi_palette_ptrs[YoshiColor]` (`$00:BA14`) — e.g. color 0 = `$0040` → PC `$1FA040` |
| A level's backdrop color | `$0130 + BackgroundColor*2` → PC `$1FA130 + …` |
| The shared common colors | the literal offsets in the X=0 program (`$027C` BG, `$01C8` OBJ) |
| A world's map | `DATA_00BB17[world]` (`$00:BB17`) |
| Storybook sprites | `$5F:ED4A` (PC `$1FED4A`) |
| Pause menu | `$5F:A002 / $A022 / $A1C8 / $A1E6 / $A204` |

> **MD5 note.** The blob is cart data — patching it changes the ROM, so the build
> will no longer match the reference MD5. This is for *emulator* experimentation,
> not for committing into yi-shiny (which is byte-exact by rule).

### 4.2 Live — patch the CGRAM mirror (no reload)

To change a color **immediately** in a running emulator without reloading the
scene, write the BGR-15 word into the **live CGRAM mirror in SRAM**:

```
color N  →  $70:2000 + N*2      (BG half  = colors $00–$7F at $70:2000–$70:20FF,
                                  OBJ half = colors $80–$FF at $70:2100–$70:21FF)
```

The NMI DMAs the whole mirror to PPU CGRAM next frame, so the new color shows up
on the following frame. (You can also poke PPU CGRAM directly, but the NMI flush
overwrites it from the mirror — patch the mirror, not the PPU.)

**Watch for the per-frame clobbers** that will overwrite a live mirror edit:

| If… | …then also patch |
|---|---|
| The level has an **animated palette** (header AnimationPalette ≠ 0) and your color is in a cycled row | the animation **source** in bank `$5F` (the row is re-copied every frame, `enginecore.md` §5.6) |
| A **fade** is in progress / will run | the **fade base** mirror at `$70:2D6C + N*2` (fades rescale from there, `enginecore.md` §9) |
| The player can **pause** | the pause **snapshot** at `$7E:B6E0` (BG) / `$7E:B7E0` (OBJ), since pause saves+restores the mirror (§3.6) |
| A **Graphic/Palette-Changer** sprite is ahead in the level | nothing live-patchable cleanly — it re-derives BG1 from `DATA_bg1_palette_ptrs` (`renderingpipeline.md` §1.1) |

For a change that survives fades but isn't otherwise cycled, patch **both**
`$70:2000 + N*2` **and** `$70:2D6C + N*2`.

---

## 5. Cross-references

| Topic | Where |
|---|---|
| Palette interpreter internals, glitch note | `enginecore.md` §5.1–5.5 |
| Animated palette engine (per-frame) | `enginecore.md` §5.6, `graphicsassets.md` §6 |
| Fade pipeline (ScreenBrightness + rescale) | `enginecore.md` §9 |
| NMI CGRAM DMA flush | `enginecore.md` §4.3, §5.4 |
| Sprite/OBJ palette rows 8–15 | `graphicsassets.md` §5.7 |
| BG1 Map16 `pal` field → BG row | `graphicsassets.md` §4.1 |
| Mid-level BG1 palette swap | `renderingpipeline.md` §1.1 |
| PPU BG mode per scene | `scene-bgmodes.md` |
| Color math / COLDATA (separate from CGRAM) | `renderingpipeline.md` §4 |
| Key tables: `DATA_scene_palette_layout` `$00:B78A`, `DATA_bg1_palette_ptrs` `$00:B874`, `DATA_bg2_palette_ptrs` `$00:B8F4`, `DATA_bg3_palette_ptrs` `$00:B974`, `DATA_sprite_palette_ptrs` `$00:B9F4`, `DATA_yoshi_palette_ptrs` `$00:BA14`, `DATA_master_palette_rom_blob` `$5F:A000` | `yi/Banks/Bank00.asm` |
