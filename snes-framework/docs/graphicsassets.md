# YI graphics asset composition

How each kind of on-screen graphic in Yoshi's Island is **built up from
stored cart assets** — which compressed/raw blobs, palettes, tilemaps,
Map16 blocks, OAM records, and animation tables combine to produce it.

This is the **asset-composition** companion to the rendering docs. Where they
explain *how the PPU draws* a layer, this doc explains *what files a given
asset is made of* and how they map back to the original production-asset
formats. It is deliberately cross-referential — depth on each subsystem lives
in the doc named in the right-hand column, and this doc avoids duplicating it.

| For the mechanism of… | See |
|---|---|
| BG2/BG3 PPU config, parallax, HDMA effects | `bg23rendering.md` |
| Layer model, contributors, color math | `renderingpipeline.md` |
| Compressed-gfx loader (LZ2/LZ16 → VRAM) | `enginecore.md §6` |
| Palette pipeline (CGRAM mirrors → PPU) | `enginecore.md §5` |
| Per-screen palette → CGRAM loading + live-edit recipe | `scene-palettes.md` |
| Map16 stamping, object streams | `leveldataengine.md` |
| Sprite state machine / dispatch | `spritestateengine.md` |
| SuperFX rasterisers, dynamic-tile decode | `mchip.md §3` |

---

## 1. The building blocks

Every YI graphic is assembled from a small set of component types. None of
the stored assets is a finished picture — the image only exists once the PPU
composites these per scanline.

| Component | Stored as (cart) | What it is |
|---|---|---|
| **Tile graphics (CHR)** | LZ2 / LZ16 compressed blobs, or raw `.bin` | 4bpp planar 8×8 tiles, in VRAM-upload order. Pixels are **palette indices**, never colors. |
| **Mode-7 char** | raw `.bin` (uncompressed) | 8bpp linear char for the rotation/scale layer. |
| **Palette** | BGR555 color rows in ROM, staged through CGRAM mirrors | The colors the tile indices resolve to. Separate from the tiles → recolor + palette animation. |
| **Map16 block table** | `$4C:32A4` index + `$4C:33F2` page data | 16×16 blocks, each = 4 sub-tile words (`vhopppcc cccccccc`: tile index + H/V-flip + priority + 3-bit palette). The reuse unit for BG1. |
| **Pre-rendered tilemap** | `Tilemaps/*.lz2` (16-bit entry arrays) | Whole BG2/BG3 screens of tile references. Not Map16 — DMA'd wholesale to VRAM. |
| **OAM / metasprite layout** | per-sprite draw code emitting OAM records | Which CHR tiles + position + palette + flip make up one sprite cel. |
| **Animation tables** | tile-anim ptrs `$00:D6C2`; palette-anim ptrs `$01:C454` | Ordered per-frame source lists that the engine cycles into a fixed VRAM/CGRAM slot. |

### 1.1 Correspondence to the production-asset formats

The cart blobs were authored as standard SNES production assets and then
compressed/sliced for ROM. Each cart component maps cleanly back to one
authoring-format family:

| Cart component | Authoring format family | Holds (beyond raw pixels) |
|---|---|---|
| Tile graphics (CHR) | character/tile data (`CGX` → `CHR`/`CHRN`) | bpp + VRAM tile-slot range; palette is a *separate* file |
| Mode-7 char | Mode-7 char (`CH7` → `CPC`) | 8bpp packed char for rotation/scale |
| Palette | palette set (`COL`) | BGR555 rows; named sub-ranges incl. animation frame-sets |
| BG2/BG3 tilemap | screen tilemap (`SCR`) | per-cell tile + flip/priority/palette bits |
| BG1 layout (pre-flatten) | panel/unit tilemap (`PNL`) | per-cell tilemap words; 16-tile reusable block "units" |
| Sprite cel | metasprite/OAM layout (`OBJ`) | OAM-tile records (not pixels) |

These authoring groupings are **lossless and reversible**: decompressing a
cart tile blob yields raw 4bpp planar CHR identical to the corresponding
source tile-range slice (verified — see §2). The cart keeps the *runtime*
groupings (tilesets, spritesets, Map16 pages); the *authoring* groupings
(which tiles were drawn together) are recoverable from the per-blob VRAM
destinations.

### 1.2 What these formats add over a PNG

A PNG is a finished, device-independent raster: one flat grid of RGBA pixels
with the palette baked in. The YI formats are the opposite — **decomposed,
hardware-shaped ingredients**:

- **Tiles, not a raster.** 8×8 planar tiles in VRAM-upload order, not a
  scanline raster.
- **Indexed + external palette.** Pixels are palette indices; colors live in
  a separate palette asset (enables recolor and palette-cycle animation).
- **Per-cell hardware flags.** Tilemap entries pack H/V-flip, priority, and
  palette-select alongside the tile index.
- **Layers + dedup.** BG1/BG2/BG3/OBJ are separate, each unique tile stored
  once and referenced many times; the composite is assembled per-scanline.

(The detailed binary layout of each authoring format is tracked outside the
repo; this doc stays at the composition level.)

---

## 2. From stored blob to VRAM

The common path for compressed tile graphics (`enginecore.md §6`):

```
LZ2/LZ16 blob  ──GSU decompress──►  raw 4bpp CHR  ──DMA──►  VRAM tile slot  ──►  PPU
   (DATA_06F95E / DATA_06FC79 pointer tables, indexed by file ID)
```

- **LZ2** (`FXCODE_08A980`) stages to SRAM `$70:5800`, then the 65816 DMAs to
  VRAM. Used for tile graphics **and** BG2/BG3 tilemaps (265 entries).
- **LZ16** (`FXCODE_0A8000`) streams tiles directly through the GSU plot
  pipeline (187 entries, tile graphics only).
- A few regions are stored **raw** (uncompressed `.bin`) because the GSU reads
  them directly: e.g. the Mode-7 char and the per-frame animation strips.

**Decompression granularity.** Each compressed tile blob decompresses to one
fixed-size CHR page (typically 4 KB = 128 4bpp tiles). Consecutive file IDs
occupy consecutive VRAM tile slots, so the per-blob VRAM destinations recover
the original contiguous tile-range groupings. Decompression is byte-exact
against the reference LZ implementations (verified 2026-05-26; `enginecore.md
§6`).

---

## 3. Backgrounds — BG2 / BG3

BG2 and BG3 are **whole pre-rendered tilemaps** (not Map16-stamped). Each is
built from: a **char graphics** blob (→ char VRAM), a **tilemap** blob (→
tilemap VRAM), and a **palette** block. The header's BG2/BG3 Tileset fields
pick the char+tilemap files; the BG2/BG3 Palette fields pick the CGRAM block
(`bg23rendering.md §1`). They differ by *how those components are combined and
animated*, not by where they come from. The graphically-distinct kinds:

### 3.1 Standard parallax tilemap (the common case — BG2 and BG3)
char CHR + pre-rendered tilemap + palette, scrolled by the per-frame parallax
multiply (`bg23rendering.md §5`). BG2 ≈ mid parallax, BG3 ≈ deep parallax.
This is the default for both layers across most LevelModes.

### 3.2 Tile-index-wraparound BG2 (shared graphics)
A BG2 tilemap whose 10-bit tile indices deliberately wrap past `$FFFF` to
**reuse BG1/HUD char data** instead of carrying its own (e.g. 1-2 hills/
clouds). Same component types; the "char graphics" is partly borrowed, and
off-screen scroll hides the wrapped rows (`renderingpipeline.md §5.4`).

### 3.3 Self-scrolling / animated BG3 (water, clouds)
Standard tilemap **plus** a self-scroll offset (BG3 Tileset `$1A`/`$2D`) and
usually **palette-cycle animation** (cloud/water color sets) and/or
**CHR animation** (water-surface frame strips). Adds animation-table inputs
(§6) on top of the standard composition.

### 3.4 HDMA-modulated BG3 (wavy water, sun rays)
Standard tilemap whose per-scanline scroll/color is modulated by HDMA
(channels 3/4/7 → BG3 HOFS/VOFS; 1/2 → COLDATA), with the GSU regenerating the
modulation tables each frame (`bg23rendering.md §6.2`). Graphics source is the
same tilemap+char; the *effect* is per-scanline.

### 3.5 Offset-per-tile BG3 (LevelMode `$03`)
BG Mode 2 with a per-tile BG3 offset (the "3D rock / fuzzy" effect). Same
char+tilemap composition; special PPU mode + IRQ (`bg23rendering.md §6.4`).

### 3.6 Mode-7 background (Raphael, LevelMode `$09`)
**Different composition**: 8bpp Mode-7 char + Mode-7 tilemap + a per-frame
rotation/scale matrix solved on the GSU. No flip/priority/palette per-cell;
the "circular BG3 around the moon" is Mode-7, not a tile layer
(`bg23rendering.md §6.5`).

### 3.7 Generated backdrop — sky gradient (not tiles)
The "sky" behind many levels is **not** a tile layer. When BackgroundColor ≥
`$10`, the GSU interpolates 24 BGR15 keyframes into a per-scanline color
table that HDMA streams to COLDATA (split by color plane across channels
1+2), and color math paints it as a gradient — visibly **banded** by the
5-bit color depth (`renderingpipeline.md §4.5`, `bg23rendering.md §6.1`).
No CHR, no tilemap — pure generated color.

### 3.8 BG3 as HUD / overlay
BG3 doubles as the **status-bar** layer (score/timer/lives tiles) above the
level split, and at stage-intro the GSU **writes the level-name string as
tiles** into the BG3 tilemap (`renderingpipeline.md §3.2`,
`enginecore.md §4.7`). Same char/tilemap mechanism, dynamically populated.

---

## 4. Foreground objects — standard & extended

Level terrain and decorations are placed by the **object stream**, parsed into
**Map16 block IDs stamped into the BG1 level-data buffer** (`$7F:8000`)
(`leveldataengine.md §2-3`). Both object classes resolve to the *same*
graphics path:

```
object record ──► Bank12/13 handler ──► Map16 ID into $7F:8000
   ──► Map16 page table ($4C:33F2) ──► sub-tile words ──► BG1 char VRAM ──► PPU
```

BG1 char VRAM is filled from the level's **3 BG1 tileset files**
(`DATA_bg1_tileset_files` `$00:AF39`, indexed `BG1Tileset*3`; World 6 uses the
dark variant). So an object's pixels ultimately come from the BG1 tileset CHR;
*which* tiles it uses come from its Map16 block definitions.

### 4.1 Standard objects
First record byte `1-254`; dispatched via `$12:81FE`. Mostly **resizable
structural terrain** (floors, walls, slopes, pipes, vines, water/lava bodies)
encoded as length-only or W×H runs. Graphically: a run of Map16 cells →
BG1 CHR. The "common small structural pieces" (`leveldataengine.md §4`).

### 4.2 Extended objects
First record byte `$00` + an ext-ID; dispatched via `$12:8000`
(`DATA_128000`, 256 entries). Mostly **fixed-shape named decorations** —
a fixed small pattern of Map16 cells rather than a parametric run. Some ext
IDs are *non-graphical* (they set flags/state, e.g. the Baby-Mario float
limiter) and stamp nothing.

> **Graphics tie-in is identical for §4.1 and §4.2.** Standard and extended
> objects differ only in *encoding and dispatch*; both stamp Map16 blocks that
> resolve through the same BG1 tileset CHR. There is no separate graphics path
> for extended objects — the split is parametric-run vs fixed-stamp, not a
> graphics-source difference.

### 4.3 Animated objects (either class)
YI has **no per-object animation**. Instead, the tile-animation engine
(`CODE_animate_bg_tilesets` `$00:D65D`, ptr table `DATA_tile_animation_ptrs`
`$00:D6C2`, 18 types) DMAs a new CHR strip into **fixed VRAM slots** each
frame — coins `$1400`, !-blocks `$1440`, !-coins `$1480`, star blocks `$14C0`,
plus per-tileset water (`$1000-$1380`), lava, waterfalls, etc. **Any Map16
cell whose sub-tiles reference an animated slot appears animated** — so a std
or ext object is "animated" exactly when its block uses an animated tile slot.
The frame strips are read from the raw (uncompressed) animation-source regions.

### 4.4 Mid-level BG1 tileset/palette swap
A family of 16 Graphic/Palette-Changer special sprites (`$1BA-$1C9`) can
overwrite the live BG1 tileset or palette when the camera reaches them — so a
level's objects can change appearance partway through without any per-region
table (`renderingpipeline.md §1.1`).

---

## 5. Sprites

Sprites draw from OAM records that point at OBJ-region VRAM tiles. The
distinction — static vs dynamic vs animated — is about **where the tiles come
from and whether they change**, mapped to the OBJ-VRAM tiers (`enginecore.md
§6.7`): three in normal gameplay (§5.1–5.3), plus a fourth *scene-resident*
tier used only by the non-level screens (§5.5, §11).

### 5.1 Static — global-resident
Tiles in fixed VRAM **every level regardless of spriteset**: the two global
common sheets at `$8000-$9FFF` (file `$72`) and `$F000-$FFFF` (file `$19`) —
byte-identical across levels (verified across 6 different-spriteset captures).
It holds the player items (Baby Mario, eggs, watermelons, coins, HUD, score
popups) plus a broad set of common actors. The authoritative per-sprite split is
the `DATA_sprite_gfx_file_table` table (§5.2): **~231 of the 426 normal-range
sprite IDs draw only from this global page** (table entry `$0000`) and render
anywhere with **no spriteset dependency**; the other ~195 nominate a spriteset
file. (Membership is *not* reliably recoverable by force-spawning a sprite in a
single level and reading its OAM tile region: a sprite whose required spriteset
file isn't loaded there falls back to the global tile base, so such a capture
**over-counts "global"** — read the cart table, not one capture context.)

### 5.2 Static — spriteset-resident (per-level)
Tiles from the level's **spriteset**: 6 file IDs from
`spriteset_files[SpriteTileset*6]`, decompressed (LZ16) into six `$400`-byte
slots spanning `$A000-$B7FF`. This is a **major** tier — ~195 of the 426
normal-range sprite IDs nominate a spriteset file (per `DATA_sprite_gfx_file_table`,
below) — the genuinely level-specific enemies. A sprite's **slot** is fixed (its draw code
emits the same tile indices everywhere) but the **file ID** in that slot varies
per tileset (`docs/tileset-vram-atlas.tsv` SPR rows; `enginecore.md §6.7`). Tiles
resident for the whole level.

The **per-sprite GFX-file dependency** is a static table:
`DATA_sprite_gfx_file_table` (`$0A:A716`, alias `FXDATA_0AA716`) is indexed by
sprite ID and gives the GFX **file number** that sprite needs (`$0000` ⇒ it draws
only from the always-loaded global page, §5.1 — no spriteset slot). That file
number resolves to its compressed CHR via `DATA_lz16_compressed_gfx_ptrs`
(`$06:FC79`), LZ16-decompressed. So a sprite's tiles are deterministically
recoverable from the ROM (no runtime trace): sprite ID → file → decompress → its
4bpp tiles. The level's spriteset is what decides whether that file is actually
loaded (and into which slot); a sprite renders correctly only when its required
file is in the open level's spriteset.

### 5.3 Dynamic — SuperFX dynamic-tile (dyntile)
Tiles **streamed into the `$B800-$BFFF` region per frame** by the GSU, rather
than pre-loaded from a spriteset. The sprite "brings its own graphics": it
reserves a dyntile slot (`CODE_03AD74` / `CODE_03AE60`) and re-emits its CHR
each frame from a SuperFX glyph source. Used by large/rotating/scaling actors —
bosses (Sluggy, Naval Piranha), Yoshi-at-goal, Baby Luigi, spring-ball/crate
glyphs, the star sparkle (`bossengine.md §7.3`, `family-cinematic.md`,
`mchip.md §3`). A surprisingly large tier. On despawn the slot is
released (`despawn_sprite_clear_graphics`, dyntile bitfield `$7ECC`). Full
mechanics in §5.8.

### 5.4 Animated (orthogonal to 5.1-5.3)
Animation is a separate axis layered on any of the above:
- **OAM-frame animation** — the sprite's draw code points OAM at *different
  resident tiles* each frame (a metasprite walk-cycle over §5.1/§5.2 tiles).
  No VRAM upload; just changing tile indices.
- **Dyntile re-upload** — a §5.3 sprite uploads *different CHR* per frame, so
  the animation frames are streamed, not pre-resident.

So "animated sprite" is not a separate storage tier — it's a sprite of any tier
whose OAM tile indices (or streamed CHR) change over time.

### 5.5 Scene-resident (non-level screens)
On gamemode scenes that aren't levels (title, world map, cutscenes) there is no
spriteset. The gamemode loads sprite CHR **directly into a fixed OBJ VRAM
region** as part of scene setup, and builds OAM from scene-specific tables rather
than the in-level sprite engine. Examples: the world-map Yoshi/stork marker, the
title-screen decorative sprites, and the boot splash's logo cels (§11). No
spriteset dependency, no per-frame dyntile streaming — the tiles are simply baked
in for that scene.

### 5.6 OAM / metasprite assembly
The tiers say *where* a sprite's tiles live; this is how they become a cel. YI
assembles OAM on the **SuperFX**, not the 65816 (the CPU only keeps per-slot
state). The buffer chain (all `$7E` WRAM, `SRAM_Buffers.asm`):

| Stage | Addr | Role |
|---|---|---|
| OAM working buffer | `$0200` (`$0800` B) | 256 × 4-word records the GSU writes |
| Low-table mirror | `$0A00` (512 B) | 128 PPU entries `xxxxxxxx yyyyyyyy tttttttt yxppccct` |
| High-table buffer / mirror | `$0C20` / `$0C00` | 9th-X + size bits, packed 2-bits/entry |

Per record: word1 = screen X, word2 = screen Y, word3 = tile + `yxppccct` attr
(palette/priority/flip), word4 = priority/size/9th-X. The **first 16 OAM slots
are reserved** (HUD + stage-intro level-name), so sprite compaction starts at
slot 16. Each frame: `CODE_init_oam_buffer` (`$00:8259`) parks all Y's
off-screen → sprite logic runs → `CODE_spr_edge_despawn_draw` (`$03:94CF`)
dispatches GSU **`CODE_098925`** (emit + edge-cull) → per-sprite cel walker
**`CODE_098B85`** reads the slot's render-control word `$7040,x` (OAM byte-count
seeded from `DATA_sprite_render_control_table` `$0A:9B1C`), emits `(count&$F8)>>3`
**cel records** from the cel table selected by the animation-frame value `$1320,x`
indexed into `DATA_enemy_special_chr_addrs` (`$4D:048A`, a `dw` pointer table).
The compacted low+high tables DMA to PPU OAM each frame (`nmi_normal_level` →
`CODE_00D4AC`, `$7E:6A00` → `$2104`, forced-blank). OBSEL `$2101 = $02` (8×8+16×16,
name base 2); a cel's tile index classifies into the §5.1–5.3 tiers by the
`enginecore.md §6.7` math. (Bosses use a separate GSU OAM packer — `mchip.md §3.10`.)

The **edge-cull** half of `CODE_098925` is gated per-sprite by the *low* byte of
that same `$7040,x` word — `NorSpr_BehaviorFlags` (`SRAM_SpriteSlots.asm`, layout
`sf?bddmm`). Its **despawn-threshold-index** `dd` (bits 2-3, mask `$0C`) selects
how far off-screen the sprite survives; **`$00` = never despawn**. Bosses and
other persistent sprites ship with index `0` in `DATA_sprite_render_control_table`
(e.g. `$1AD` Kamek = `$3001`, lo `$01`), so the chip leaves them resident
off-screen; a normal sprite (`$1AE` magic shot = `$1805`, lo `$05`, index `1`) has
its status zeroed one frame after it scrolls past the edge. The camera-event path
`CODE_039505` exploits this — it `AND #$F3`s every slot's flags (forcing index 0)
so nothing despawns mid-cutscene, then restores them. Confirmed by runtime GSU
trace: clearing a shot's `dd` bits makes it persist off-screen exactly like Kamek.

**Cel-record format (the metasprite decode primitive).** Each cel table (e.g.
`DATA_4D1040`) is a run of **5-byte records**, one per OAM tile:

| Byte | Field |
|---|---|
| 0 | X offset (signed, from sprite origin) |
| 1 | Y offset (signed) |
| 2 | tile index (low 8 bits) |
| 3 | attribute `vhooppp·` — V/H flip, priority, 3-bit OBJ palette |
| 4 | size/high — `$02` ⇒ 16×16 (else 8×8) |

A 16×16 record expands to the 2×2 tile quad `t, t+1, t+$10, t+$11`. So decoding a
whole sprite is: frame `$1320,x` → cel-table pointer (`$4D:048A`) → N × 5-byte
records → place each tile (from its tier sheet, §5.1–5.3) at its offset with flip
+ OBJ palette (§5.7). This is the cart-side metasprite decoder.

**Draw order (intra-sprite Z).** Records are emitted to OAM **in cel-table order**,
so cel `0` takes the lowest OAM slot. The `oo` priority bits in byte 3 are
*BG-layer* priority, not inter-cel ordering — among a metasprite's own overlapping
cels (same BG priority) the SNES shows the **lower OAM index in front**, i.e.
**cel `0` is frontmost**. A compositing renderer must therefore paint
**back-to-front** (last cel first); reversing the paint order is what fixes
face-over-body type layering artifacts.

### 5.7 Sprite palette
OBJ tiles resolve color through the **OBJ half of CGRAM — rows 8–15** (words
`$80-$FF`, 8 OBJ palettes). The level-header **SpritePalette** field (`$0144`)
selects only the **last two** (palettes 6–7): `load_level_palettes` (`$00:BA24`)
resolves it through `DATA_sprite_palette_ptrs` (`$00:B9F4`, ×2) into DP `$18`.
The OBJ-half map (in-level palette program; the full BG+OBJ CGRAM map and the
per-frame clobbers are in `scene-palettes.md` §3.1):

| OBJ pal | CGRAM | Source | Varies by |
|---|---|---|---|
| 0–4 | rows 8–12 | fixed shared blob | nothing (global sprite colors) |
| 5 | row 13 | `yoshi_palette_ptrs[YoshiColor*2]` | current Yoshi color |
| 6–7 | rows 14–15 | `sprite_palette_ptrs[SpritePalette*2]` | level-header SpritePalette |

So a level's SpritePalette only repaints palettes 6–7; the common sprite colors
(rows 8–12) are level-invariant — matching the broad global tier (§5.1). Per
sprite, the OAM-attr mirror `$7042,x` (`yx00ccc0`) picks one of the 8 OBJ
palettes (`ccc`) + flip; a sprite recolors by writing it (e.g. `$1AF FloatingCoin`
ORs `|$000E` → palette 7 for the alt coin; `$115 Coin` tests the palette bit for
red vs yellow). The Graphic/Palette-**Changer** sprites (`$1BA-$1C9`) rewrite
**BG1** CGRAM, never OBJ (`renderingpipeline.md §1.1`). The palette-cycle engine
(§6) targets the **BG** half in-level — OBJ rows aren't cycled.

### 5.8 Dynamic-tile system (detail)
The authoritative dyntile spec (sketch in §5.3; uses across `bossengine.md §7.3`,
`family-cinematic.md`, `family-bvz.md`). **16 slots**, each a 16×16 (2×2-tile)
cell filling `$B800-$BFFF` (16 × 4 tiles × `$20` = `$800`); a slot's 4 OAM tile
indices come from `DATA_03AA0E` (`$03:AA0E`), GSU plot position from
`DATA_03A9CE`/`DATA_03A9EE`. In-use state = bitfield **`$7ECC`** (1 bit/slot);
the per-slot mask is cached at `$7ECE,y`; each sprite stores its **slot index in
`$7722,x`** (`BMI` = none). Allocators (Bank03):

| Routine | Pool | On failure |
|---|---|---|
| `CODE_03AD74` | shared (`DATA_03ACF6`) | carry-clear; caller decides (distance-gated) |
| `CODE_03AE60` | shared (same) | auto-despawns the sprite |
| `CODE_03D406` | — | **not a VRAM alloc** — item-memory marker register/query |

Upload is GSU-side: the 65816 wires R12/R13 (glyph source), R2/R3 (plot pos) and
`JSL BeginSuperFXProcessingRt` into **`FXCODE_088293`** (one-shot Init) /
**`FXCODE_088295`** (per-frame); glyph bitmaps live in `FXDATA_5xxxxx` regions
(`$548000`, `$550000`, `$540000`), selected by pose. A live sprite re-emits its
CHR every frame (`CODE_0F8E20`/`CODE_0F8E49`). On despawn,
`despawn_sprite_clear_graphics` (`$03:A331`) `TRB`s the cached mask into `$7ECC`
to free the slot. (The `$0CF9` "in-flight" bump is **overloaded** with the
BG3-tilemap flush — not a dyntile-only count.)

**Rigid vs rot/scale dyntile — both statically decodable, but the nibble can differ.**
Two sub-kinds. The source is the SAME format for both — a plain **chunky** bitmap,
4bpp index per byte, **256-byte row stride** — and the only decode difference is which
**nibble** of each byte holds the index. **That nibble is NOT set by which plotter
draws it.** Both plotters (rigid `CODE_088295`, rot/scale `CODE_088205`) carry the
identical idiom `MOVE R0,R12 : LSR : BCC + : OR #4 : CMODE` — i.e. they conditionally set
**POR bit 2** (the SuperFX "color high-nibble" plot-option, which makes `GETC`/`PLOT`
take the color from `byte >> 4`) **from R12 bit 0**, a per-draw control the caller seeds.
So the nibble is a property of the *draw command*, not the plotter — **validate it
empirically per sprite** (byte-match BOTH nibbles against an identity-scale capture; the
right one matches ~100%, the wrong one ~30%). Empirically so far rigid bodies have used
the low nibble and the one rot/scale body checked used the high — a useful prior, not a
rule.
- **Rigid** (no per-frame transform): the GSU plots the glyph 1:1 via the dyntile
  uploader; the rasterized VRAM equals the source verbatim, so a brute-force of the
  captured body against the cart finds the exact offset. Decoded **LOW nibble** in every
  case checked. Examples: Chomp Rock `$09E` → `$55:6020`, the doors → `$55:6000`, Spring
  Balls, Bucket.
- **Rot/scale** (the GSU draws through a rotzoom matrix — `CODE_05A800` →
  `FXCODE_08D5F1` builds the M7-style matrix from sin/cos LUTs `DATA_08AB98`/
  `DATA_08AE18`, then `CODE_088205` plots with `MERGE`-addressed fractional
  accumulators): the source is STILL a plain static bitmap — the rot/scale is a *runtime*
  transform applied at runtime to the **un-scaled** texture (identity); the stored
  source is that un-transformed bitmap (the scale is a nearest-neighbour upscale, the
  same `scale` knob rigid blocks like `$094` use). The piranha head reads the **HIGH nibble** (`byte >> 4`).
  Earlier this whole class was mis-recorded as "trace-only": it is not — the trap was
  reading the wrong nibble (yields garbage).

**Worked example — Wild Piranha `$066` / `$054` (a mixed sprite).** Its metasprite
splits across **two** tiers at once: a **static stem** (three **8×8** records — OBJ
tiles `$1aa`/`$1ba`/`$1ba`-hflip — from its spriteset GFX file **`$29`**, byte-exact:
VRAM `$1aa/$1ba` == file-`$29` tiles `10`/`26`) plus a **rot/scale dyntile head**
(four 16×16 records = a 32×32 in the `$B800+` dynamic region) the GSU draws via
`CODE_05A800` from `FXDATA $54:60C0` — decoded **HIGH-nibble**, 32×32, byte-exact
(688/688 px) against the identity-scale rendered VRAM. (Note the size split: the head
records are 16×16, the stem records are 8×8 — decoding the stem as 16×16 wrongly pulls
the adjacent quad tile `11`, a different sprite.) **Capture caveat:** the piranha is a
proximity sprite — dormant (un-drawn, no `$54` reads) until Yoshi nears, so the trace
that confirmed the head must warp Yoshi **adjacent** (record `$72`, cell ~(200,91)) to
make it emerge + briefly hit identity scale (`R8=R9=$0100`).
The **Wild Ptooie Piranha `$09F`** (the green spitter) is the same mixed sprite — it
shares the head+stem draw routine `CODE_05A769` (10 callers = the whole piranha family),
so it reuses the identical `$54:60C0` high-nibble head + the same stem cel, differing only
in the head palette row (0 = green, vs `$066`'s row 1 = red). `$054` is the ceiling
(vflipped-stem) variant.

### How the source address is resolved (the dyntile texture pointer is a STATIC literal)

The earlier framing — "the dynamic-body source is GSU-runtime-computed; recover it
empirically per sprite" — is **wrong, and led to a long offset-guessing detour.** The
texture source is a plain literal in each sprite's draw-setup code, so **every dynamic-body
source is statically grep-able from the asm** — no trace, no VRAM crack, no visual hunt.

**The idiom.** Each sprite shape's draw-setup routine loads the GSU texture pointer into
registers **R12 (low 16 bits)** and **R13 (bank)** before kicking the SuperFX plotter:

```asm
    LDA.w #FXDATA_540000+$4060          ; texture offset  → R12 (R12_LOOPCounterLo)
    STA.w !REGISTER_SuperFX_R12_LOOPCounterLo
    LDA.w #(FXDATA_540000+$4060)>>16    ; texture bank    → R13 (R13_LOOPAddressLo)
    STA.w !REGISTER_SuperFX_R13_LOOPAddressLo
```

The plotter (`CODE_088205` rot/scale, `CODE_088295` rigid) then reads each texel as
`R14 = MERGE(R7,R8) + base` within bank R13 — i.e. `(R13:R12)` **is the bitmap top-left**.
(The `R12_LOOPCounter`/`R13_LOOPAddress` register *names* are misleading — here they're
repurposed as the source base. The door/mirror plotter `FXCODE_08D317` takes the base in
**R9/R11** instead — so match on the `FXDATA_` literal itself, not the destination register.)

**`FXDATA_NNNNNN` is an ABSOLUTE 6-hex SNES address, not a bank-relative offset** — mind the
base: `FXDATA_540000` = `$54:0000` but `FXDATA_548000` = `$54:8000`, so `FXDATA_548000+$60C0`
= **`$54:E0C0`**, NOT `$54:60C0`. Dropping the `8000` lands in the wrong half of the bank —
which is how the `$098` yoshi-block was first mis-sourced to the Wild Piranha's `$54:60C0`.

**Two forms:**
- **Single-frame body** → a literal immediate as above (e.g. `init_muddy_buddy`/`CODE_05E63A`
  → `$54:4000`; the submarine morph icon `CODE_02989E` → `$55:60F0`; the boss door
  `CODE_02A153` → `$55:60C0`; `init_bvz_large_spring_ball` → `$55:40E0`).
- **Animated body** → a per-frame **pointer table** `DATA_<sprite>_gfx_ptrs` the draw indexes
  by animation frame. E.g. **`DATA_chain_chomp_gfx_ptrs` = `[$54:9080, $54:9090, $54:90A0,
  $54:9090]`** — the Chain Chomp `$082`'s 4 frames; the neutral/resting frame is `$54:9090`
  (it appears twice). Burt `$0E7`'s `init_burt` loads a *set* of small pieces
  (`$56:6000/$56:6020/$56:6030` + more via `CODE_06A5A6`) that the handler assembles
  (multi-piece, mirror-completed like the doors).

**The nibble, revisited.** The high/low nibble is the per-draw POR-bit-2 flag set from
R12 bit 0 (§ above), so it is plausibly encoded in the **parity of the source offset
immediate** — several loads end in an odd `$XXXX1` (e.g. `$55:0061`, `$54:40E1`,
`$56:6041`), which would set R12 bit 0 → high nibble, with the actual byte address being
`offset & ~1`. Treat this as a strong lead, still to be cross-checked per sprite against a
rendered decode (it's cheap now that the offset is known).

---

## 6. The animation inputs

Two independent engines, both fully data-driven (frame lists in cart data):

| Engine | Driver | Ptr table | Cycles | Used by |
|---|---|---|---|---|
| **CHR / tile animation** | `CODE_animate_bg_tilesets` `$00:D65D` | `DATA_tile_animation_ptrs` `$00:D6C2` (18) | new CHR strip → fixed VRAM slot per frame | BG1 object tiles (coins/!-blocks/water/lava), animated BG3 |
| **Palette-cycle animation** | dispatch in Bank01 (`$01:C21C`+) | `DATA_animation_palette_ptr` `$01:C454` (21) | new color rows → CGRAM per frame | water/cloud/lava/waterfall color sets, etc. (the title-screen sparkle is a similar CGRAM cycle but **hand-driven** in Bank17, not this engine — §11.2) |

The level header's Animation-Tileset (`$0148`) and Animation-Palette (`$014A`)
fields select which entry runs. Frame counts and source strips are explicit in
each handler's source-pointer table, so an animation's full frame set is
recoverable from cart data alone. The **palette-cycle** engine re-writes its
CGRAM rows every frame, so it overwrites a static palette edit on those rows —
the per-screen loading paths and which rows each clobbers are in
`scene-palettes.md` (§3.1, §4.2).

**Recognisable instances** (illustrative — full per-type enumeration is deferred,
§13): *palette-cycle* covers waterfalls, pipes, forest dappled light, clouds,
lava, snow, and the abyss (4- or 8-frame CGRAM cycles); the title-screen
**sparkle** is a similar 8-frame cycle but **hand-driven** (Bank17, not this
engine — §11.2); *tile-CHR*
covers the always-loaded coins / !-blocks / star blocks plus per-tileset water
surfaces, lava, and torches (the worked examples use set `$07` = fort lava-water
§8 and the default coin cycle, vs. the cave's palette set `$12` §9).

---

## 7. Composition matrix

What each asset type draws from. ✓ = primary input, · = sometimes/conditional.

| Asset type | CHR blobs | Palette | Map16 | Pre-rend. tilemap | OAM | Tile-anim | Pal-anim | Mode-7 | Gradient |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| BG2 parallax | ✓ | ✓ | | ✓ | | | · | | |
| BG3 parallax | ✓ | ✓ | | ✓ | | · | · | | |
| BG3 self-scroll/anim | ✓ | ✓ | | ✓ | | ✓ | ✓ | | |
| BG Mode-7 (Raphael) | | ✓ | | · | | | | ✓ | |
| Sky gradient | | ✓ | | | | | | | ✓ |
| Std object | ✓ | ✓ | ✓ | | | · | | | |
| Ext object | ✓ | ✓ | ✓ | | | · | | | |
| Sprite — global | ✓ | ✓ | | | ✓ | | · | | |
| Sprite — spriteset | ✓ | ✓ | | | ✓ | | · | | |
| Sprite — dynamic | ✓ | ✓ | | | ✓ | · | · | | |
| Sprite — scene-resident (§5.5) | ✓ | ✓ | | | ✓ | | | | |
| World-map screen (§11.1) | ✓ | ✓ | | ✓ | ✓ | | | | |
| Title / island screen (§11.2) | ✓ | ✓ | | ✓ | ✓ | | · | ✓ | |
| Boot / splash text (§11.3) | ✓ | ✓ | | | ✓ | | | | |

Two inputs aren't columns above because they're effects, not stored asset types:
**HDMA** (per-scanline COLDATA gradient, scroll modulation, the title's BGMODE
split) and the **Mode-7 transform matrix** (GSU-computed for Raphael §10 and the
title island §11.2). The world map also **shares** BG1+BG2 (one map picture
across two layers, §11.1) rather than drawing two independent tilemaps.

---

## 8. Worked example A — 5-4 "Sluggy's Fort" (record `$27`)

A structural, sprite-rich level decomposed into every asset it pulls, to ground
§1–6 concretely. Chosen for breadth: 28 distinct standard objects + 10 extended (260 + 20
instances) and 28 distinct sprites (83 instances) spanning all three sprite
tiers. (Header decoded from the cart; object/sprite IDs from the per-level
instance indexes `docs/level-object-index.tsv` / `level-sprite-index.tsv`.)

### 8.1 The header — what it selects
The 10-byte packed level header (`leveldataengine.md §3`) resolves to:

| Field | Value | Selects |
|---|---|---|
| BackgroundColor | `$00` | Solid backdrop (`< $10` ⇒ no sky gradient) |
| BG1 Tileset | `$0A` | 3 BG1 char files → `$38, $39, $46` (LZ2) |
| BG2 Tileset / Pal | `$14` / `$14` | BG2 char+tilemap files `$80, $81` |
| BG3 Tileset / Pal | `$02` / `$00` | BG3 char+tilemap files `$16, $15` |
| **Sprite Tileset** | **`$34`** | 6 spriteset files → `$42,$43,$55,$1F,$41,$1A` (LZ16) |
| LevelMode | `$0B` | Normal in-level (BGMODE `$69`, TM=BG1+OBJ) |
| **Animation Tileset** | **`$07`** | 4-frame tile cycle into VRAM `$1000-$1180` |
| Animation Palette | `$00` | None (no palette-cycle this level) |
| BGScrollSetting | `$04` | Parallax rates row 4 |

### 8.2 Background layers (brief)
BG1 char VRAM is filled from the three tileset-`$0A` files `$38/$39/$46`; the
foreground itself is built by the object stream (§8.3). BG2 = `$80/$81`, BG3 =
`$16/$15` (pre-rendered tilemaps, `bg23rendering.md`). BackgroundColor `$00` ⇒
flat backdrop, no gradient. So the level's **distinct background-graphics
blobs**: BG1 `$38/$39/$46`, BG2 `$80/$81`, BG3 `$16/$15`.

### 8.3 Foreground objects → BG1 Map16
The object stream stamps Map16 blocks into the BG1 grid, resolving to the
`$38/$39/$46` char tiles (§4). The 28 distinct **standard** objects are almost
all fort structure; the 10 **extended** objects are guides, signs, and two
non-graphical actions:

| Group | IDs | Graphics |
|---|---|---|
| Castle masonry (walls/pillars/bricks/window) | std `$41 $43 $44 $45 $46 $48 $49 $CB $CC $CD` | Static BG1 tiles |
| Platforms / stairs / floors | std `$37 $55 $69 $6C $6E $79` | Static |
| Pipes | std `$A5 $A6 $F4` | Static |
| Line-guide rails (platform tracks) | std `$CE $D2` + ext `$9A $9B` | Static |
| Hazards | std `$A7` (spikes), `$A8` (eraser), `$A4` (breakable rock) | Static |
| **Coins (animated)** | std `$68 $C4 $C5 $C6` | **Animated** — universal coin slots `$1400-$14C0` |
| Winged-cloud reward guides | ext `$12 $13` (platforms), `$14 $15` (stairs) | Static |
| Signs | ext `$50 $A8` | Static |
| **Actions (no graphics)** | ext `$FD` (clear cell), `$FE` (Baby-Mario float flag) | Stamp nothing |

So the only **animated objects** here are the coins (driven by the universal
coin animation). The header also loads tile-anim set `$07` (fort lava/water,
sourced raw from `DATA_568000+$4800`), though the lava object itself (`$47`)
isn't among this room's placed objects — a reminder that the header loads an
animation set independently of whether a given room places its tiles.

### 8.4 Sprites → OAM
28 distinct sprites, classified per sprite by its `DATA_sprite_gfx_file_table`
entry (§5.2 — `$0000` ⇒ global page, else the named spriteset file) checked
against the fort's loaded spriteset (§8.5: files `$42 $43 $55 $1F $41 $1A`):

| Tier | Count | Sprites |
|---|---|---|
| **Global-resident** (table entry `$0000`) | 13 | `$025` GreenEgg, `$065` RedCoin, `$04F` MiddleRing, `$01E` Shyguy, `$06A` YellowEggBlock, `$0BA/$0BB/$0BD/$0C1` Winged-Clouds, `$12C` Fly/WhirlyGuy, `$18B` LineGuidedPlatform, `$0B5` HiddenWingedCloud, `$161` reward spawner |
| **Spriteset-resident** (file loaded by §8.5) | 7 | `$090` DanglingGhost (file `$42`), `$0F4` EggPlant (`$1F`), `$111` GeorgetteJelly (`$41`), `$13D/$13E` Fangs + `$145/$146` small Sluggies (`$55`) |
| **Dynamic-tile** (`$B800+`, SuperFX) | 5 | `$082` ChainChomp, `$093` Door, `$144` Flippers, `$18F` SpiralPlatform, `$0FA` Flower |
| **Non-graphics controllers** (`>= $1BA`) | 3 | `$1D6` H-scroll lock, `$1DC/$1DD` fang-gen control |

So the fort **does exercise the spriteset tier** — 7 of its enemies draw from the
spriteset files the header loads (§8.5), not the global page. (A single-context
OAM capture mislabels these "global": force-spawned in a level whose spriteset
lacks `$42/$1F/$41/$55`, each sprite falls back to the global tile base — the
over-count §5.1 warns about. The cart table is authoritative.) The dynamic-tile
sprites stream CHR per frame (§5.8); `$0FA` Flower is the SuperFX bloom. `$04F`
MiddleRing is genuinely **global** (`$0000` entry; its sparkle uses common-sheet
tiles + an item-memory marker, *not* a dyntile slot — a frequent mislabel). The
GSU-dyntile **boss** Sluggy (`$0D7`) is in the connected arena (record `$8A`);
`$145/$146` are unrelated small slimes sharing the name.

### 8.5 Bill of materials
Every distinct stored asset this level pulls:

- **BG1 char:** LZ2 files `$38`, `$39`, `$46`
- **BG2:** files `$80`, `$81` · **BG3:** files `$16`, `$15`
- **Sprite spriteset:** LZ16 files `$42`, `$43`, `$55`, `$1F`, `$41`, `$1A`
- **Global sprite sheets:** files `$72` (`$8000`), `$19` (`$F000`) — always loaded
- **Palettes:** BG1 `$1D`, BG2 `$14`, BG3 `$00`, Sprite `$00` (CGRAM blocks)
- **Animated tile sources:** universal coins (`$1400-$14C0`); set `$07` raw CHR at `DATA_568000+$4800` → VRAM `$1000-$1180`
- **Map16:** BG1 blocks from the tileset-`$0A` page set (resolved via the `$4C:32A4`/`$4C:33F2` tables); object stream stamps them into `$7F:8000`
- **Dynamic-tile CHR:** streamed per-frame for `$04F`, `$0FA` (and the boss in room `$8A`)

---

## 9. Worked example B — 6-5 "The Very Loooooong Cave" (record `$31`)

A deliberate contrast to §8. Where the fort was static-BG with **tile-CHR**
animation and structural objects, this World-6 lava cave is **BG-effect-driven**:
gradient sky, self-scrolling BG3, and **palette-cycle** animation — and it's an
**autoscroller**. It exercises the BG/animation paths §8 skipped.

### 9.1 Header — what changed vs the fort

| Field | Cave `$31` | Fort `$27` | Path it lights up |
|---|---|---|---|
| BackgroundColor | **`$18`** (≥`$10`) | `$00` | Sky **gradient** (§3.7) |
| BG3 Tileset | **`$2D`** | `$02` | **Self-scrolling** BG3 (§3.3) |
| Animation Palette | **`$12`** | `$00` | **Palette-cycle** animation (§6) |
| Animation Tileset | `$00` (default) | `$07` | Cave has *no* special tile-CHR anim |
| World | **6** (dark tileset) | 5 | BG1 from the **dark** tileset table |
| LevelMode | `$08` | `$0B` | (both normal in-level) |

### 9.2 Backgrounds — now load-bearing
- **BG1** Tileset `$08`, resolved through the **World-6 dark** table → char files
  `$30, $31, $40` (World 6 takes the dark BG1 table; it differs from the normal
  table only at tileset `$01`, so tileset `$08` lands on the same files — §12).
- **BG2** `$83, $84`; **BG3** `$68, $62` — and BG3 **self-scrolls**: tileset `$2D`
  drives `Layer3X = camX + (frameCounter >> 3)`, so the deep background drifts on
  its own (`bg23rendering.md §5.2`).
- **Gradient sky** (BackgroundColor `$18`): the GSU builds a per-scanline COLDATA
  table that HDMA streams per scanline (§3.7) — the fort's flat backdrop had none.

### 9.3 Animation — palette, not tiles (the inverse of §8)
- **AnimationPalette `$12`** → handler `CODE_01C955`, a **composite** palette-cycle
  that runs several CGRAM color sub-cycles per frame (incl. rows from
  `DATA_5FF9DE`). The cave's lava glow / shifting light comes from cycling
  **colors**, leaving the tiles fixed.
- **AnimationTileset `$00`** = default (no special per-frame CHR swap). So this
  level animates almost entirely via CGRAM, where the fort animated via VRAM CHR —
  the two halves of §6 demonstrated by one level each.

### 9.4 Objects (same path, dark tileset)
24 distinct std + 9 ext, stamping Map16 → BG1 (now the dark `$30/$31/$40` char).
Mostly basic cave terrain (`$01` FloorBasic, `$02/$03` edges, `$04-$09` slopes/
ground), coins (`$68`, `$C4`, `$C6` — the only **animated** objects, universal coin
slots), and a pipe (`$F4`). Extended: a sign (`$50`), line/guide helpers, and the
non-graphical actions (`$FE` Baby-Mario float flag, `$FF`). Identical mechanism to
§8.3 — the contrast is purely the **dark tileset** source.

### 9.5 Sprites — lava-themed
18 distinct sprites, classified per `DATA_sprite_gfx_file_table` against the
cave's loaded spriteset (§9.6: files `$71 $1A $51 $5F $60 $30`):

| Tier | Count | Sprites |
|---|---|---|
| **Global-resident** (table entry `$0000`) | 5 | `$025` GreenEgg, `$065` RedCoin, `$089` MovingRedPlatform, `$08D` Flyguy, `$0C1` WingedCloud |
| **Spriteset-resident** (file loaded by §9.6) | 5 | `$110` Flower (file `$71`), `$12F/$130` Lava Drops (`$51`), `$19A` BooGuy (`$60`), `$190` FallingIcicle (`$5F`) |
| **Dynamic-tile** (`$B800+`) | 5 | `$080` StraightLavaBubble, `$093` Door, `$09E` ChompRock, `$0EC/$0ED` Jumping/Running FlamerGuy |
| **Non-graphics controllers** | 3 | `$0D0` entrance, `$1CD/$1CF` autoscrollers |

The cave's roster is a **mix** of global, spriteset (its lava actors — Lava
Drops, Boo Guy, Falling Icicle, and the Flower — draw from the spriteset files
§9.6 loads), and dynamic-tile (bubble, flame guys, chomp rock stream CHR). The
distinctness vs the fort is the **lava theme** (its spriteset + palette-cycle
set) plus the autoscroller controllers `$1CD/$1CF`, not the global/spriteset
split — both rosters span all three static tiers.

### 9.6 Bill of materials
- **BG1 char (dark):** `$30, $31, $40` · **BG2:** `$83, $84` · **BG3:** `$68, $62`
- **Sprite spriteset:** LZ16 `$71, $1A, $51, $5F, $60, $30` · **Global:** `$72, $19`
- **Palettes:** BG1 `$12`, BG2 `$13`, BG3 `$2C`, Sprite `$00`
- **Animated assets:** gradient COLDATA table (GSU-generated); palette-cycle set
  `$12` (CGRAM rows incl. `DATA_5FF9DE`); universal coin slots `$1400-$14C0`. *No*
  tile-CHR animation source.
- **Map16:** dark-tileset `$08` BG1 page set → stamped into `$7F:8000`

### 9.7 The two examples side by side

| | Fort `$27` (§8) | Cave `$31` (§9) |
|---|---|---|
| Sky | solid backdrop | per-scanline **gradient** |
| BG3 | static parallax | **self-scrolling** |
| Animation | **tile-CHR** (set `$07`) | **palette-cycle** (set `$12`) |
| BG1 tileset | normal | **World-6 dark** |
| Level flow | normal | **autoscroller** |
| Sprite roster | global + dynamic mix | global + dynamic (lava-themed) |

Between them the two examples exercise every path in §1–6 at least once.

---

## 10. Worked example C — Mode-7 boss (Raphael the Raven, record `$CB`)

The third rendering archetype: a **Mode-7** scene. Raphael's moon fight
(LevelMode `$09`) abandons the tile-layer pipeline of §8/§9 entirely.

### 10.1 Header
BackgroundColor `$00`; **BG1/BG2/BG3 Tileset all `$00`** (unused — BG2/BG3 are
off in Mode-7); SpriteTileset `$27`, Sprite Palette `$0C`; LevelMode **`$09`**;
AnimationTileset `$04` (no-op), AnimationPalette **`$01`** (random palette-cycle).

### 10.2 The Mode-7 background
LevelMode `$09` routes through `CODE_load_levelmode_09_settings` **instead of**
`load_level_gfx` (the mode-`$09`/`$0A` branch even skips `load_bg2_tilemap` /
`load_bg3_tilemap`). It installs **Mode-7** (BGMODE `$07`), loads the **8bpp
Mode-7 char + Mode-7 tilemap**, and a custom HDMA set. The "moon surface that
wraps in a circle" is the Mode-7 plane, and its **per-frame rotation/scale
matrix is solved on the GSU** (`FXCODE_088B49`). So the background is 8bpp char
+ Mode-7 tilemap + a GSU transform — no parallax tilemap, no per-cell
flip/priority/palette. (`bg23rendering.md §6.5`.)

### 10.3 Sprites & animation
SpriteTileset `$27` resolves to spriteset files mostly `$1A`; Yoshi + eggs stay
global-resident; **Raphael himself is a SuperFX dynamic-tile boss** (streams his
CHR per frame, §5.3). AnimationPalette `$01` = the random palette-cycle
(`CODE_anim_pal_01_random_cycle`) — the **twinkling starfield**; AnimationTileset
`$04` = no-op (no tile-CHR animation). Motion = starfield palette-cycle + the
Mode-7 matrix.

### 10.4 Bill of materials
- **Mode-7 char (8bpp) + Mode-7 tilemap** (via `load_levelmode_09_settings`)
- **GSU rotation matrix** (`FXCODE_088B49`) + custom HDMA set
- **Sprites:** spriteset `$27` (mostly `$1A`) + global `$72`/`$19`; Raphael dynamic-tile
- **Palette-cycle set `$01`** (starfield); sprite palette `$0C`
- *Absent:* BG2/BG3, any pre-rendered parallax tilemap, any tile-CHR animation

---

## 11. Non-level screens — boot splash, title, world map

§8–10 are all **levels** (a 10-byte header → tilesets/spriteset/LevelMode).
The screens outside gameplay skip that pipeline entirely: they're **gamemode
scenes** with hardcoded loaders and bespoke sprite systems. (For how each of
these screens loads **CGRAM** — which palette program it runs and which rows it
fills — see `scene-palettes.md` §3.2–3.6.) Three are documented
below — the **world map** (§11.1), the **title / island** scene (§11.2), and the
**boot splash** (§11.3).

### 11.1 World-map screen (gamemode `$20`/`$22`)
Driven by gamemodes `$20` (`prepare_overworld`) / `$22` (loop) / `$24`
(post-clear walk), keyed off `CurrentWorld` (`$0218`) — **not** a level header.

- **BG: Mode 1, not Mode-7.** Scene-register slot `$28` installs BGMODE `$01`,
  TM = BG1+BG2+BG3+OBJ. BG1 and BG2 **share** tilemap base (`$1C00`, both
  `BGnSC=$1C` — trace-confirmed §11.5) and char base (`$2000`) — both on the main
  screen reading **one picture**, with the per-tile **priority bit** splitting it
  into a **back plane** (terrain, palettes 0/6) and a **front plane** (paths +
  per-level icons, palettes 3/7); the duplicated BG gives extra priority levels so
  the walking Yoshi/stork marker can sandwich between map layers, and color math
  (CGADSUB `$B7`, subtract; TS=`$00`) adds a shade. (An earlier note said ">16
  colors"; the trace shows no sub-screen layer, so it's **priority planes + a
  color-math shade**, not a >16-color blend) — BG3 (`$1400`) is the HUD /
  world-number text. Char loaded by
  `load_world_map_gfx` (`scene_gfx_layout` at Y=`$A2`) + a per-world BG1/BG2
  pair; the visible map is streamed into the `$1C00` tilemap **per frame** by the
  world-fold state machine, not preloaded.
- **Sprites: a bespoke OAM marker system**, not the spriteset engine. OBSEL is
  forced to `$03` (OBJ base VRAM `$C000`); the Yoshi/stork token is built
  directly into the `$7E:6000` OAM-staging block — effectively a fourth
  *scene-resident OBJ* tier. Level-circle / path icons are part of the **BG map
  tilemap**, not sprites.
- **Animation:** none of §6 — the in-level tile/palette engines are gated off.
  Motion is the marker's OAM walk-cycle + live tilemap-queue writes (worlds
  folding open).
- **Palettes:** per-world master + 4 sub-rows (`load_world_map_palettes`).
- **World-change fold is Mode-1, not Mode-7 (trace-confirmed).** The
  world-change "fold-open" animation (the `world_map_state` machine,
  `CODE_world_map_state_0*` in Bank17; sub-state byte `$7E:1118`, `$01` =
  "clicked other world") runs **entirely in BGMODE `$01`** — the `world-map-dump`
  fold capture (which sets `$1118=$01` then watches the fold) reads BGMODE `$01`
  and an **identity, unanimated Mode-7 matrix** on every fold frame. The "fold"
  is a **BG tilemap / scroll wipe**, not a Mode-7 rotation. (The only Mode-7
  matrix HDMA in Bank17 is the **title** screen's, §11.2; and the world-map gfx
  all load via the LZ decompressor, whereas YI's real Mode-7 char loads raw — so
  no Mode-7 char is even present. An earlier note here claimed a Mode-7 fold;
  that was a dev-era design that did not ship.)

**Composition.** The world map is built from: the **per-world map picture**
(the BG1+BG2-shared tilemap + its CHR + the per-world palette), the
**HUD / world-number** BG3 text, the **Yoshi/stork marker** (a scene-resident
OBJ cel + its walk path), and the **level-circle / path icons** (part of the map
tilemap, not sprites). The active map graphics live at the trace-logged bases
(BG1/BG2 char byte `$4000`, tilemap byte `$3800`; BG3 char `$2000`, tilemap
`$2800`); the fold is a Mode-1 tilemap/scroll wipe, so the map's only transform
layer is BG scroll (no Mode-7).

The BG tilemap at VRAM word `$1C00` holds one word per cell (`vhopppcc
cccccccc`); each cell's char resolves from base word `$2000`, 4bpp planar, under
its 3-bit palette (CGRAM BG rows 0–7). Split by the priority bit, a level's
on-map icon is its front-plane (palettes 3/7) cells, and a level-slot → map-cell
mapping fixes where each level sits on the map. The visible tilemap is the 32×32
on-screen window, streamed per frame (not all resident), so off-screen level
slots appear only as the map scrolls to them.

### 11.2 Title / island scene (gamemode `$09` load, `$0A` tick)
The **title screen** — the "Yoshi's Island" logo over a floating green island and
a receding sea — is the showcase composed scene: several independent pieces, each
translated/scaled to fake a 3-D rotation. Loader `CODE_gm_load_title_screen`
(`$17:80D6`); per-frame tick `CODE_gm_fade_to_title_screen` (`$17:87D5`, the
gamemode-`$0A` entry despite its name).

**The defining trick — a per-scanline BGMODE split.** An HDMA channel rewrites
BGMODE (`$2105`) partway down the frame: the **top region runs Mode 0** (flat BGs
— sky, clouds, logo) and the **bottom region runs Mode 7** (the island + sea),
with companion HDMA re-designating the main-screen layers across the same split.
A SuperFX routine recomputes a **per-scanline Mode-7 matrix** every frame from a
single **island-angle** word (`!EXRAM_YI_Global_IslandAngleLo` `$0CA0`):
`FXCODE_08C745` reads the angle, looks up sin/cos, scales by a 1/distance
perspective ramp (`DATA_08D011`), and writes the per-line M7A/M7C that the matrix
HDMA streams out — so the whole lower plane recedes and sways. That one angle
word is the scene's master "rotation" control.

The scene composes from these pieces:

| Piece | Layer | Graphics source | Placement / transform |
|---|---|---|---|
| Sea / water | Mode-7 (lower) | Mode-7 char + tilemap (title gfx list) | per-scanline Mode-7 matrix (angle `$0CA0`); per-scanline color shimmer from gradient `DATA_5FCC2E` |
| Floating island | Mode-7 (lower) | pre-rendered tilemap `DATA_5F9800` (W1-5) / `DATA_5F9C00` (W6), GSU-streamed | same Mode-7 matrix + M7 center as the sea → rotates/sways with the angle; art swaps per world |
| "Yoshi's Island" logo | BG2 (Mode-0 top, 8×8) | raw tilemap `DATA_title_screen_logo_tilemap` (`$0F:FC80`) → VRAM `$3E40` (not Map16) | static position; **palette per 8×8 cell** (CGRAM 32–47); **fully static** — its CGRAM block is never rewritten (the per-frame cycle is the OBJ sparkle, see the Sparkle row; decode in §11.2.1) |
| Sky + clouds | BG (Mode-0 top) | `DATA_0FF800` (`$0F:F800`) or `DATA_5F9380` (`$5F:9380`) → VRAM `$3C00` | static BG; a per-frame cloud OBJ stream is rebuilt by `FXCODE_08C712` |
| Decorative sprites | OBJ | title CHR (files `$73`/`$74`) | engine `CODE_178919` walks 16 slots seeded from `DATA_10EEA2`/`DATA_10EEE3`: twinkle sparkles, a fast spinning sparkle, the flying-Yoshi cinema sprite, the Stork — each with orbit / jitter / path motion |
| Sparkle palette shimmer | CGRAM (OBJ) | ping-pong table `DATA_5FC77E` (8 frames) | one **OBJ** slot — CGRAM 247 (`$F7` = OBJ pal 7, col 7: the palette all 40 decorative sprites share) — cycled per frame; the logo's BG2 palette does **not** animate |

**Graphics provenance** (trace-confirmed — see the `title-render` trace
scenario). Char loads through `CODE_load_overworld_gfx` (scene chunk-list at
Y=`$4F`); the gm`$09` decompress chain captured live is: `$1F` → VRAM `$3400`
(LZ2), `$1D` → `$3800` (LZ2), `$73` → `$5C00` **and** `$7C00` (LZ16), `$74` →
`$3C00` (LZ16), `$B1` → `$0000` (LZ2). The first file is **`$1F` on a normal
boot** — the loader swaps in `$68` only for the final-world-unlocked /
high-score variant (the cart's own comment has this backwards; the trace shows
`$1F`). The raw layout destinations carry the high LZ16-format flag bit (`$74`'s
`$BC00` → true VRAM word `$BC00 & $7FFF = $3C00`). These are **scene-resident**
tiles (§5.5): baked in by the loader, no spriteset, no dyntile. No header
AnimationTileset/Palette set is in play — every animation above is hand-driven
by the tick handler: the trace shows the island angle (`$0CA0`) sweeping every
frame while `HDMAEnable=$FE` keeps the BGMODE-split + Mode-7-matrix + gradient
channels live, and the per-scanline matrix buffer (`$7E:5040`) holding a
non-constant perspective ramp.

**Mode-7 lower plane.** The island/sea plane is genuine PPU Mode-7 (the
`title-render` trace reads `ppu.bgMode=7` at the bottom scanline); its 8bpp
Mode-7 char and Mode-7 tilemap occupy VRAM `$0000-$3FFF`, byte-interleaved in
the SNES Mode-7 layout: the **low bytes** of words `$0000-$3FFF` are a
**128×128 grid of 1-byte tile indices** (16384 cells), and the **high bytes**
are **256 chars × 64 bytes** (8bpp linear) — so the flat Mode-7 plane is
128×128 cells = 1024×1024 px. The per-world island tilemap `DATA_5F9800`
(`$5F:9800`, worlds 1-5) / `DATA_5F9C00` (`$5F:9C00`, world 6) is a 32×32-byte
Mode-7 tilemap, streamed via the `$7E:4800` GSU descriptor list (32 chunks of
32 bytes) into the low (tilemap) lane starting at VRAM word `$0800` — chunk `c`
→ low-lane word `$0800 + c·$80`. The 8bpp Mode-7 char comes from file `$B1`
(LZ2), DMA'd to VRAM word `$0000`.

#### 11.2.1 The "Yoshi's Island" logo — BG2, Mode-0, per-8×8 palette (trace-confirmed)
The logo is a **raw BG tilemap** — a flat grid of **8×8 tilemap cells**, **not**
Map16. (Map16's 16×16 blocks are the *in-level* BG1 object-stamping path, §4; the
non-level screens never go through it — they DMA a finished tilemap straight to
VRAM, §3, §11.1.) So the logo's palette is selected **per 8×8 cell**: one 3-bit
field (the tilemap word `vhopppcc cccccccc`, bits 10–12) per cell. There is no
16×16 grouping in the *logo* — the only 16×16 in this scene is the BG1 **clouds**,
and that is the PPU's 16×16 **tile-size** mode (a different thing from a Map16
block — see "two distinct 16×16s" below), not the logo. The full decode chain
(`title-render` dumps + `Bank17`/`Bank00` asm):

- **Mode + layer.** The top-region BGMODE is `$10` — the BGMODE HDMA
  (`DATA_178070` = `$76,$10 / $6A,$07`) holds `$10` for the top 118 scanlines and
  `$07` (Mode 7) for the bottom 106 — so the top region is **Mode 0 (every BG
  2bpp)**, with BG1 in 16×16 tile-size and BG2 in 8×8 (BGMODE bit 4 set, bit 5
  clear). Top-region `TM` = BG1+BG2+OBJ (`DATA_17807A` = `$70,$13 / $70,$11`). The
  logo's tilemap char#s increment **+1 per horizontal cell** (an 8×8 layout — a
  16×16 layout would reuse overlapping `char#, +1, +$10, +$11` quads between
  neighbours), and BG2's Y-scroll `$8F` (=143) places nametable row 18 at screen
  top, so the whole logo (screen rows 1–111) lands inside the Mode-0 half (the
  Mode-0/Mode-7 split is at scanline ~118). On BG1 (Y-scroll `$60`, 16×16) the
  logo rows would overflow into the Mode-7 half — so the logo is **BG2 (8×8)**,
  and BG1 draws the **clouds** behind it. Both layers share the `$3C00` nametable
  but show different rows via their different scroll.
- **Tilemap.** `DATA_title_screen_logo_tilemap` (`$0F:FC80`) DMAs to VRAM word
  `$3E40`, `$0380` B = **448 words = 32×14 cells** = rows 18–31 of the `$3C00`
  nametable (sky/clouds fill rows 0–17 from `DATA_0FF800`/`DATA_5F9380` at
  `$3C00`, `$0480` B). Empty cells are char `$322`, a **fully-transparent** tile
  (the sky shows through).
- **Char.** `BG12NBA = $22` ⇒ BG1 & BG2 char base **`$2000` words**. The logo glyph
  tiles `$300–$37F` resolve (2bpp ⇒ ×8 words/tile) to VRAM word `$3800+` = file
  **`$1D`** (the `$1F`→`$3400` + `$1D`→`$3800` LZ2 loads cover the cloud + logo
  glyph range).
- **Palette (per 8×8 cell).** Mode 0 is the one mode that gives each BG its own
  CGRAM block — **BG2's palettes are CGRAM 32–63** (BG1 → 0–31, BG3 → 64–95,
  BG4 → 96–127). Each 2bpp sub-palette is 4 colors, so a cell's field `p`
  resolves to `CGRAM[32 + p·4 + v]` (v = 2bpp pixel 0–3; **v0 transparent**). The
  logo uses fields **0–3**:
  - Big lettering ("Yoshi's Island") = **field 1** (CGRAM 36–39) → black outline
    `$0000` + white fill `$7FFF` (a flat 2-color glyph on BG2; the color you see
    *around* it on screen is the clouds/backdrop showing through the transparent
    gaps, not extra BG2 colors).
  - Small upper line ("SUPER MARIO") = **fields 0/2/3** (CGRAM 32–35 / 40–43 /
    44–47) → red `$04DF`, yellow `$035F`, green `$03E0`, cyan `$7EE0`, white
    `$7FFF` — the clean red/yellow is the cross-check that the Mode-0 BG2
    CGRAM-base (32) is right.
- **Animation.** The logo is **fully static** — tiles, tilemap, *and* palette.
  Nothing in the title path writes the logo's CGRAM (the Mode-0 BG2 block, 32–47),
  so a captured CGRAM is a faithful still of the logo. The scene's one per-frame
  CGRAM cycle is **not** the logo: it is the decorative-sprite **sparkle** — a
  ping-pong shimmer (`DATA_5FC77E`, 8 frames) into **CGRAM 247** (`$F7` = OBJ
  pal 7, col 7, the palette all 40 title sprites share) cycling
  orange→gold→cream→white-flash (§11.2 piece table). The big lettering and small
  line keep their fixed Mode-0 BG2 colors throughout.

> **Two distinct "16×16"s — don't conflate.** (1) A **Map16 block** is a cart
> *data structure* (4 sub-tile words, `$4C:33F2`) used only for in-level BG1
> (§4); its palette is still chosen **per 8×8 sub-tile**, not per block. (2) The
> BG **16×16 tile-size** mode (BGMODE bits 4–7) is a *PPU* setting where one
> tilemap cell spans a 16×16 px quad of four CHR tiles under **one** palette
> field — so *there* the palette is genuinely per-16×16 (the title clouds, BG1).
> The **logo is neither**: a plain 8×8 BG2 tilemap, palette per 8×8 cell.

### 11.3 Boot / power-on splash (gamemodes `$00`–`$04`)
The very first thing the cart draws is a **warning splash** — a screenful of text
on a near-blank background. (The framework labels these modes "Nintendo Presents";
what the code actually plots is the peripheral / region warning.) Handlers live
in Bank10: prep `CODE_gm00_ninpresents_prep` (`$10:838B`), controller check
`CODE_gm01_ninpresents_load` (`$10:891E`), hold `CODE_gm03_ninpresents_show`
(`$10:83E7`). Flow: `$00` set-up → `$01` controller handshake → `$02` fade-in →
`$03` hold (`$011A` 128-frame timer) → `$04` fade-out into the attract-cutscene
loader (`$05`).

- **Two gating checks, two separate error paths.** `$00` reads PPU-2 status (`$213F`
  bit 4 = 50/60 Hz): on a mismatched **PAL** console (`CODE_1086EC`) it diverts to the
  **hardware-check halt** (`$43` fade → `$44`) — a permanent palette-ramp halt that
  never advances, so only power-off/reset escapes; on **NTSC** it plots the
  **peripheral warning** ("…designed only to play with a normal controller.
  please disconnect Mouse, Super Scope, etc…") and continues to `$01`. `$01` (the
  controller check, `CODE_10891E`) then serial-reads both joypads to detect a
  floating/disconnected pad or an impossible D-pad state and, on failure, routes to
  the **controller-error screen** (`$41` fade → `$42`, "please turn off the power").
  Unlike the PAL halt, `$42` **recovers** — it re-runs the check each frame and
  soft-reboots to `$00` once a valid controller is present.
- **Text is GSU-rasterized, not a stored tilemap.** The strings are **codepoint
  streams** (`DATA_ninpresents_text_stream`, `DATA_1089DC`) of `(set-X, set-Y,
  set-attr, char…)` records. The SuperFX text plotter `FXCODE_09E9AF` rasterizes
  them into a 4bpp bitmap in SRAM (`$70:4C00`), which is DMA'd to BG char VRAM
  (`$6000`) with a matching run of sequential tilemap rows DMA'd to `$7800` — i.e.
  the GSU draws the letters as pixels and the tilemap just lays the bitmap out
  left-to-right. The glyph shapes come from the common sheet, not a dedicated font
  blob.
- **Graphics.** Exactly one CHR file is loaded — file **`$72`** (the always-
  resident common sprite sheet, §5.1) → VRAM byte `$8000`, via scene-gfx-layout
  start offset Y=`$68` — plus palette block **`$40`**. A small **logo/copyright
  OBJ** (4 cels from `DATA_ninpresents_gsu_table`) is written straight into the
  OAM buffer (`$7E:6A00`).
- **Composition.** Two pieces: the **text block** (the codepoint stream + the
  common-sheet glyph tiles it rasterizes from) and the **logo/copyright sprite**
  (4 OBJ cels + their CHR in file `$72` + palette `$40`).

> All three non-level screens use the **scene-resident OBJ** tier (§5.5): sprite
> CHR loaded directly by the gamemode into a fixed OBJ VRAM region, distinct from
> the in-level global / spriteset / dynamic-tile tiers of §5. The **title island**
> puts a layer in **Mode-7** (the translate+scale path that, among normal content,
> only a Mode-7 boss §10 reaches); the **world map and its fold stay in Mode 1**
> (trace-confirmed, §11.1) — only the title is Mode-7.

### 11.4 Prologue cutscene (gm`$38` load, `$39` tick) — per-graphic palette
The "Once upon a time…" storybook intro (the stork + the Yoshi train) is a
cutscene scene, loaded self-contained by `CODE_gm38_load_intro_cutscene`
(`$10:DA33`): it resolves its own level-data pointers (storybook translevel slot
`$0A`), sets its gfx files into DP `$10-$1C`, loads them through the **in-level**
scene layout (Y=`$00`, the §12 atlas — not a bespoke list), then writes its
palettes (BG rows from `DATA_5FEC4A` + a `$7FFF` backdrop, OBJ rows from
`DATA_5FED4A`). gm`$39` ticks the cutscene phases (`DATA_intro_cutscene_phase_ptrs`,
by `$0D27`).

**The rainbow Yoshi train — which palette each graphic uses (trace-confirmed).**
This scene is the clearest case of the rule that a graphic's palette
is read at its own granularity. The `prologue-render` trace reads it directly:

| Graphic | Tier | Palette (trace) |
|---|---|---|
| Cutscene Yoshi `$12D`, 8 slots | OBJ | **each slot a different OBJ palette** — rows 13, {10,15}, {11,14}, {9,12}, {9,12}, 8, {10,15}, 11 |
| Lead green Yoshi (`$061`) | OBJ | OBJ palette 5 = CGRAM row 13 (`$03E0`, pure green) — the canonical Yoshi-color slot (§5.7) |
| BG2 storybook layer (tilemap → VRAM word `$3800`) | BG | BG palette row 6 (uniform across cells) |
| BG3 storybook layer (tilemap → VRAM word `$3400`) | BG | BG palette row 0 (uniform) |

So the multicolor Yoshi train is **one metasprite drawn eight times under eight
different OBJ palette rows** — not eight tile sets. The CGRAM dump shows all eight
OBJ rows (8-15) loaded with distinct Yoshi colors; a Yoshi's color comes from
its OAM attribute palette bits, *not* its CHR. That per-record (OBJ) / per-cell
(BG) palette read is the general "which palette does this graphic use" answer; the
trace emits the full breakdown as `prologue.palette-map.txt`.

**Graphics provenance (gm`$38` decompress chain, trace-confirmed):** BG1 char
`$23`×3 → VRAM words `$0000/$0800/$7000`; BG2 `$B1/$B2` → `$1800/$2000`; BG3
`$1A/$17` → `$2800/$2C00`; spriteset `$AB/$AC/$1A…` → `$5000+`; plus the always-on
global sheets `$72`/`$19` and HUD/font `$12/$76/$4F` — the standard in-level VRAM
atlas (§12), since the prologue rides the level GFX layout.

### 11.5 Per-graphic palette — the full pass (trace-confirmed)
A shared trace helper (`scene_palette.lua`) runs a per-graphic palette read
across all four non-level scenes (the `boot-render`, `title-render`,
`prologue-render`, `world-map-dump` scenarios). For each it reads, at the captured
frame, **which palette every graphic uses** — OBJ palette per sprite (PPU-OAM
attr bits → CGRAM rows 8-15, or per-NorSpr-slot when the in-level sprite engine
drives the scene) and BG palette per layer (tilemap word bits 10-12 → rows 0-7,
each layer's tilemap base read from the real `BGnSC` mirrors `$095F/$0960/$0961`):

| Scene | CGRAM rows loaded | OBJ (sprites) | BG (layers) |
|---|---|---|---|
| **Boot splash** | BG `0`; OBJ `8` only | logo = 4 cels, all **OBJ pal 0** (row 8), tiles `$00/$02/$04/$06` | text on **BG pal 0** (row 0) — the whole splash is two palettes |
| **Title / island** | BG `0-6`; OBJ `8-15` | all 40 decorative sprites on **OBJ pal 7** (row 15) | top half is **Mode 0** (2bpp): BG1 (16×16, clouds) + BG2 (8×8, logo) share tilemap base `$3C00` but draw *different* rows via different scroll — the per-cell 3-bit field is a 2bpp palette-select into each layer's own Mode-0 CGRAM block (BG1→0–31, **BG2 logo→32–47**), not a 4bpp row 0–7 (§11.2.1); lower half is Mode-7 (island/sea — colors sit in CGRAM directly) |
| **Prologue** | BG `0-7`; OBJ `8-15` | **Yoshi train**: sprite `$12D` × 8 slots, **each a different OBJ palette** (rows 13 / {10,15} / {11,14} / {9,12} / {9,12} / 8 / {10,15} / 11); lead Yoshi `$061` = OBJ pal 5 (row 13, green) | BG1 base `$6800` rows 3-6 (storybook art); BG2 `$3800` row 6; BG3 `$3400` row 0 |
| **World map** | BG `0-7`; OBJ `8-15` | 59 sprites across OBJ pals 1/4/5/6/7 (Yoshi marker tiles `$6E` on pal 5 = row 13) | **BG1≡BG2 share base `$1C00`** (one map picture, rows 0/3/6/7 — confirms §11.1); BG3 base `$1400` row 0 = HUD / world-number |

Two patterns generalise: (1) **shared CHR + per-record palette select** is how YI
recolors repeated graphics — the prologue's 8-color Yoshi train is one metasprite
under eight OBJ palette rows, while the boot/title scenes draw all their sprites
from a single OBJ palette each; (2) two BGs **sharing one tilemap base** has *two*
forms here — the **world map** `$1C00` is the ">16-color single picture" trick
(§3.2, §11.1): both BGs (Mode 1) read the *same* picture at the same scroll, split
by priority. The **title** `$3C00` is **not** that trick: it is Mode 0, and its two
BGs read the same nametable at *different* scroll + tile-size, so they show
*different* pictures (BG1 clouds vs BG2 logo) — same base, different output
(§11.2.1). Which colors a graphic uses is fixed by the CGRAM its attr/word
bits point at — not by the CHR — read at the BG's true depth (2bpp Mode-0
sub-palette vs 4bpp row) and CGRAM block.

---

## 12. Tileset → VRAM atlas

An in-level scene always decompresses a **fixed set of chunks into fixed VRAM
slots**; only the *file IDs* vary, picked from the per-tileset tables by the
header's tileset fields. So the atlas is one fixed slot map × the per-tileset
file lists. The slot map (from walking `scene_gfx_layout` at Y=0):

| Slot | VRAM word | VRAM byte | Fmt | Filled from |
|---|---|---|---|---|
| BG1 #1/#2/#3 | `$0000` / `$0800` / `$7000` | `$0000` / `$1000` / `$E000` | LZ2 | `bg1_tileset_files[t*3 + 0..2]` |
| BG2 #1/#2 | `$1800` / `$2000` | `$3000` / `$4000` | LZ16 | `bg2_tileset_files[t*2 + 0..1]` |
| BG3 #1/#2 | `$2800` / `$2C00` | `$5000` / `$5800` | LZ2 | `bg3_tilesets_files[t*2 + 0..1]` |
| SPR slot0–5 | `$5000`…`$5A00` (+`$200`) | `$A000`…`$B400` | LZ16 | `spriteset_files[t*6 + 0..5]` |
| Global SPR | `$4000` / `$7800` | `$8000` / `$F000` | LZ16 | fixed files `$72` / `$19` |
| HUD / font / status | `$1200` / `$1500` / `$6000` | `$2400` / `$2A00` / `$C000` | — | fixed files `$12` / `$76` / `$4F` |

BG1 file-ID table (16 tilesets; the central one — the worked examples cite it):

| t | files | t | files | t | files | t | files |
|---|---|---|---|---|---|---|---|
| `$0` | `00,01,40` | `$4` | `04,05,42` | `$8` | `30,31,40` | `$C` | `34,35,42` |
| `$1` | `02,03,41` | `$5` | `06,07,43` | `$9` | `32,33,41` | `$D` | `36,37,47` |
| `$2` | `08,09,44` | `$6` | `0C,0D,46` | `$A` | `38,39,46` | `$E` | `3C,3D,46` |
| `$3` | `0A,0B,45` | `$7` | `0E,0F,47` | `$B` | `3A,3B,45` | `$F` | `3E,3F,47` |

- **World 6 (dark)** uses a parallel BG1 table that differs from the normal one
  **only at tileset `$01`** (`69,6A,6B` instead of `02,03,41`) — the dark
  Bowser-castle reskin; every other tileset resolves identically.
- **BG2 char base** is the `$7000`-word PPU register even though BG2 data loads
  at `$1800`/`$2000` — the deliberate tile-index wraparound (`bg23rendering.md
  §5.4`); BG2 reads its tiles through the wrap.
- The full per-tileset tables (BG1 + dark, all 32 BG2, 48 BG3, 128 sprite
  tilesets, with their VRAM slots) are generated to
  **`docs/tileset-vram-atlas.tsv`** (240 rows).

---

## 13. Animation type catalogue

The full enumeration of §6's two engines. Usage counts are how many of the 219
level records select each value (decoded from the header `$0148`/`$014A` fields).

### 13.1 Tile-CHR animation (`DATA_tile_animation_ptrs` `$00:D6C2`, 18 entries)
Each handler DMAs a CHR strip into a fixed VRAM word slot per frame; sources are
the raw `FXDATA_520000` / `DATA_568000` regions. "Behavior" is derived from the
VRAM band + motion + which tilesets/levels select it. The five formerly
medium-confidence themes (`$05 $06 $0C $0F $10`) were checked against the levels
that actually select each (below).

| Type | VRAM target | Frames | Behavior | #lvls |
|---|---|---|---|---|
| `$00` | `$1000` band | 8 | generic scrolling-CHR baseline | 108 |
| `$01` | `$2F00` strip | 4 | full-strip backdrop swap | 5 |
| `$02` | `$1000`–`$1380` | 16 | **water surface** | 9 |
| `$03` | `$2F00` strip | 16 | **smiley clouds** | 8 |
| `$04` | — | — | no-op (no tile animation) | 10 |
| `$05` | `$2F00` strip | 14 | backdrop-strip cycle — lake-shore + castle (not waterfall-specific) | 6 |
| `$06` | `$7F00`/`$2F00` | 8 | castle-context variant of `$05` (mostly castle rooms) | 5 |
| `$07` | `$1000`–`$1180` | 4 | **torch/flame flicker** (fort lava-water; §8) | 17 |
| `$08` | `$1000`+`$1100` | 4 | **lava / molten surface** | 2 |
| `$09` | `$2F00` | 4 | backdrop page-scroll (4 pages) | 6 |
| `$0A` | `$2F00` | 8 | backdrop page-scroll (8 pages) | 6 |
| `$0B` | `$1000`–`$1380` + `$2F00` | mixed | water + animated-backdrop combo | 3 |
| `$0C` | `$1000`–`$1180` | 6 | **water surface** (World-3 lakes — Nep-Enuts, Monkeys' Lake) | 19 |
| `$0D` | `$1000`–`$1180` + `$2F00` | mixed | torch flicker + backdrop | 7 |
| `$0E` | `$1000`–`$1180` + `$2F00` | mixed | surface + backdrop combo | 1 |
| `$0F` | `$2F00` | 4 | intermittent backdrop — mixed contexts (cave/jungle/cutscene) | 5 |
| `$10` | `$2F00`+`$2F80` | 4 | paired half-strip backdrop — **unused** (no level selects it) | 0 |
| `$11` | `$1000`–`$1180` + `$2F00` | mixed | smiley-clouds + surface combo | 1 |

**Always-on default (independent of type):** every frame `CODE_animate_bg_tilesets`
also cycles the **coins** (`$1400`, 8-frame), **!-switch blocks** (`$1440`),
**!-coins** (`$1480`, 8-frame), and **star/Super-Mario blocks** (`$14C0`,
16-frame) from `FXDATA_520000`, via the parallel tables at `$00:D59D/D5DD/D61D`
(16-frame overall period). Primed `$20×` at level load.
(`$38`: 1 anomalous record selects an out-of-range type.)

### 13.2 Palette-cycle animation (`DATA_animation_palette_ptr` `$01:C454`, 21 entries)
Each rewrites a CGRAM color range per frame into both palette mirrors
(`$70:2000` / `$70:2D6C`); sources are `DATA_5F…` color rows in Bank57.

| Type | CGRAM | Frames | Behavior | #lvls |
|---|---|---|---|---|
| `$00` | — | — | none | 133 |
| `$01` | row 4 | 8 | random shimmer (special scenes only) | 0 |
| `$02` | `$05`–`$07` | 4 | velocity-reactive accent | 10 |
| `$03` | row 7 | 4 | **lava glow** (castle/fort) | 14 |
| `$04` | `$71`–`$7F` | 8 | **waterfall shimmer** | 5 |
| `$05` | `$71`–`$78` | 8 | cave ambient drift | 5 |
| `$06` | composite | 8 | dark-cave glow | 2 |
| `$07` | composite | — | cave glow (special, unused) | 0 |
| `$08` | `$53`–`$56` | 4 | snow / mountain accent | 4 |
| `$09` | `$01`,`$09` | 8 | castle pulse / torch flicker | 8 |
| `$0A` | `$53`–`$56` | 4 | blue-tint (composite building block) | 0 |
| `$0B` | `$01`–`$03` | 8 | snow fade-in (skiing intro) | 3 |
| `$0C` | `$01`–`$03` | 8 | skiing transition (one-shot, self-disables) | 1 |
| `$0D` | `$01`–`$03` | 8 | sky / cloud tint | 5 |
| `$0E` | composite | mixed | cave water + glow (big cave group) | 15 |
| `$0F` | `$05`–`$07` | 4 | boss-room accent flicker | 3 |
| `$10` | `$49`–`$4F`+`$71`–`$78` | 8 | lava-cave glow + drift | 4 |
| `$11` | composite | mixed | abyss / pit fade | 1 |
| `$12` | composite×3 | mixed | **deep lava cave** (§9 cave) | 1 |
| `$13` | composite | mixed | underwater bonus glow | 3 |
| `$14` | — | — | alias of `$13` (duplicate pointer) | 0 |

Notes: **composites** (`$06 $07 $0E $10 $11 $12 $13`) call several sub-cycles;
`$13`/`$14` are the same handler; `$0C` self-disables on completion; `$01`/`$07`/
`$0A`/`$14` are reached by no level record (special-scene or building-block only).
(`$1B`: 1 anomalous record selects an out-of-range type.)

---

## 14. Authoring-format internals

The byte-level layout of the production-asset formats §1.1 maps the cart back to.
Each is a **data region** plus a fixed-size **metadata block** that the build
tools drop — which is exactly why a cart-decompressed blob equals the format's
data region byte-for-byte (§2): the metadata never enters the ROM.

| Format | Total | Data region | Metadata block | bpp | Data layout |
|---|---|---|---|---|---|
| **CHR** | `n×$1000` | all | none | 4 | Raw planar 4bpp tiles — the ROM-ready form; a cart LZ2/LZ16 blob decompresses to exactly this. Byte layout: 32 B/tile; row `r` (0-7) bytes `2r`/`2r+1` = bitplanes 0/1, `16+2r`/`17+2r` = bitplanes 2/3, pixel bit MSB-first per column. |
| **CGX** (tile) | data + `$500` | front | trailing **`$500`** (`$100` tool block + `$400` attribute map) | 4 | Same planar tiles as CHR, **plus** a per-tile attribute / color-group map (which palette region each tile uses — edit-time only). |
| **CGX** (Mode-7) | data + `$100` | front | trailing **`$100`** | 8 | 8bpp char, no attribute map. |
| **CH7** | `$10000` | all | none | 8 (2 planes) | Mode-7 char, intermediate stage. |
| **CPC** | `$8000` | all | none | 4 packed | Mode-7 char packed one nibble-pair byte per pixel (built from two CH7 planes). |
| **COL** | `$400` | first **`$200`** | trailing `$200` | — | `$200` = 256 BGR555 colors (16 palettes × 16). |
| **PNL** | `$10100` | last `$10000` | **leading `$100`** | — | `$10000` = 32768 tilemap words (256 × 128 cells) — a BG1 panel; each word = tile + H/V-flip + priority + palette. |
| **SCR** | `$2300` | first **`$2000`** | trailing `$300` | — | `$2000` = 4 × (32×32) BG2/BG3 screen tilemaps; same word format. |
| **OBJ** | data + block | front | trailing block | — | Sprite-cel / OAM-tile layout records (positions + tile refs + attrs) — **not** pixels. |

**Two key consequences (§2):**

1. **What to strip to byte-match cart data:** `CHR`/`CH7`/`CPC` → nothing (raw);
   tile `CGX` → drop trailing `$500`; Mode-7 `CGX` → drop trailing `$100`; `COL` →
   use first `$200`; `PNL` → drop leading `$100`; `SCR` → use first `$2000`.
2. **The data region is format-pure.** Pixels are indices only (no baked color);
   the palette is a separate `COL`; tilemap entries carry the hardware
   flip/priority/palette bits. This separation (§1.2) is what lets the cart
   stream the same tiles under different palettes and animate them (§6).

**Compressed forms.** Alongside the raw `CHR`/`SCR` there exist *compressed*
authoring variants (`CHRN`/`scrN` — a palette-table + per-line RLE/delta scheme).
The **shipped cart does not use these**: its graphics ship as **LZ2 / LZ16**
(and a few raw `.bin` for GSU-direct reads) — see §2. So the cart→source path is
*decompress LZ2/LZ16 → raw planar tiles → equals a `CGX`/`CHR` data region*, not
the `CHRN` scheme.

> **Note — the cart is the source of truth.** These describe the production-asset
> formats generically; every format fact here is verified against
> the final **V1.0 cart** (§2). Development-era revisions of the game's assets
> exist and differ from V1.0 (e.g. a reorganized sprite-ID space and a fraction of
> the tile pages) — so the shipped cart, not any earlier asset version, is ground
> truth, and identifiers must be confirmed against it rather than carried over.

---

## 15. Cross-references

| Topic | Where |
|---|---|
| BG2/BG3 PPU config, parallax, HDMA, Mode-7, gradient | `bg23rendering.md` |
| Layer contributor map, color math, SuperFX boundary | `renderingpipeline.md` |
| LZ2/LZ16 loader, sprite-VRAM map, format dispatch | `enginecore.md §6` |
| Palette loader | `enginecore.md §5` |
| Object stream, Map16 page table, stamp handlers | `leveldataengine.md` |
| Sprite dispatch / state machine | `spritestateengine.md` |
| SuperFX dynamic-tile decode, rasterisers | `mchip.md §3`, `bossengine.md §7.3` |
| Graphic/palette changer sprites | `renderingpipeline.md §1.1` |

