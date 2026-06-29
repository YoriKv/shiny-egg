# YI level-loader reference

A standalone reference for the **upstream** half of the Yoshi's Island
level-loading pipeline: how the engine goes from "player presses A on a
world-map tile" to "gamemode `$0F` running with the level decoded into
WRAM/SRAM". This complements `docs/leveldataengine.md` which documents the
downstream object-decode side (Bank10/Bank12/Bank13).

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank17.asm`, `yi/Banks/Bank0F.asm`, `yi/Banks/Bank01.asm`,
`yi/Banks/Bank10.asm`, and
`yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm`.
Verified via `yoshisisland-disassembly/disassembly/bank17.asm`,
`bank01.asm`, `bank00.asm`.

---

## 1. Pipeline at a glance

Loading a level walks through nine stages. Stages 1-6 are the **upstream**
(this doc); stages 7-9 are the **downstream** (`docs/leveldataengine.md`):

```
1. Game-mode $22 (gm22_overworld, Bank17 $17:B3CD)
   Player roams the world map. Every frame:
     - Reads controller mirrors $7E:0035/0036/0037/0038.
     - Ticks world-map state machine via DATA_17C813 (world_map_state_ptr).
     - On A/B press over a playable tile: CODE_17E03E (level_select) latches
       the chosen level ID into !RAM_YI_Level_CurrentLevelFromMapLo ($7E:021A),
       fires SoundID5D (SelectLevel), and advances the global gamemode to $1E.

2. Game-mode $1E / $1F (Bank00 gm1e_start_select_level_fade)
   Fade-out transition out of the world map. Two-step:
     - $1E (Bank00 $00:8270): clears tilemap, queues fade-to-black.
     - $1F (Bank00 gm_fade_alt): runs the fade tick until $7E:0200 says done,
       then advances to $0B (post-fade level-entry).

3. Game-mode $0B (Bank00 gm_fade_screen_in_out)
   Generic fade-state -- screen settles black, music dampens. On completion
   advances to $0C (level-name + fade-in).

4. Game-mode $0C (Bank01 gm0c_level_fadein_and_name, $01:AF90)
   THE LEVEL-DATA STAGING POINT. Per-tile checks `!r_level_load_type`:
     - Type 0 (stage intro from map): reads the translevel/tile-slot in $7E:021A,
       indexes level_entrance_indexes (DATA_17F3E7 / DATA_0FE446), then
       map_level_entrances (DATA_17F471 / DATA_0FE4D0); takes entrance X/Y from
       record bytes +1/+2 and the level-data ID from byte +0.
     - Type >0 (screen-exit warp): reads $7F:7E00,x (live exit table) for
       destination level-data ID + X/Y + entrance state.
   Then for both paths, runs `.set_level_pointers`:
     - level-data ID  *6  ->  Ptrs:[id]  ->  $32/$33/$34 (object ptr)
                                          +  $70:2600/01/02 (sprite ptr)
   Then `.handle_level_header`:
     - JSL unpack_level_header (Bank10 $10:8B15) -- bit-extract the 10-byte
       header into 16 WRAM fields $7E:0134..$7E:0152.
     - Set per-level music ($7E:014E).
     - JSL load_level_gfx (Bank00 $00:.....) -- loads BG1/BG2/BG3/sprite gfx
       per the header's tileset indices into VRAM slots $F0-$FC.
     - JSL load_level_palettes -- writes the per-level CGRAM payload.
       (LevelMode 9 and $0A take neither of the two loads above: mode 9
       substitutes `load_levelmode_09_settings`, mode $0A substitutes
       `load_levelmode_0A_gfx` + `load_levelmode_0A_palettes`. The level-data
       pointer load + `unpack_level_header` that precede them are mode-agnostic,
       so the object/sprite decode is identical across every mode.)
     - load BG2/BG3 tilemaps (skipped for LevelMode 9 = Raphael, 10 = autoscroll).
       BG2 and BG3 are pre-rendered tilemap incbins (decorative parallax
       layers). The interactive **BG1 foreground** is built differently --
       it's stamped cell-by-cell from the object stream by Bank13
       handlers (see §6 below and `docs/leveldataengine.md` §2.1 for the
       full layer model).
   At this point the level is fully resident in VRAM/CGRAM/WRAM but
   no object stream has been parsed yet.

5. Game-mode $0D (Bank01 gm0d_level_fadein_post_pipe_or_door, $01:B36B)
   Per-pipe-or-door re-entry path: clears entrance-state, sets player state
   from the entrance-type byte, advances to $0E.

6. Game-mode $0E (Bank01 gm0e_level_fadein_to_control, $01:B....)
   Fade-in tick. When fade complete, advances to $0F. This is where the
   object-stream parser FIRST runs:
     - JSL CODE_108B5D (Bank10 LoadLevelData) -- the master parser. The
       FIRST thing it JSLs (right after PHB/PHK/PLB) is
       init_per_tileset_template_slots (Bank10 CODE_109257), which
       populates the sparse low-WRAM region $00:19DA-$00:1DFC with
       per-tileset Map16 anchor IDs (driven by the level header's BG1
       tileset byte $7E:0136). Bank13 cell-stamp handlers consume
       these slots downstream for shape detection (see
       docs/leveldataengine.md §3.9). Then walks [LevelDataPtr],y
       stream byte-at-a-time, dispatches each object via Bank12 init
       handlers, which write Map16 IDs to !RAM_YI_Level_LevelDataBuffer
       ($7F:8000). See docs/leveldataengine.md S3 for the per-object decode.
     - Screen-exit list parsed into $7F:7E00 (live exit table, 4 bytes per
       screen, 128 entries fitting the 16x8 max-size level).
     - Sprite list parsed via Bank01 sprite-spawn helper; each 3-byte record
       allocates a slot in either the **normal-sprite** table (`$000`-`$1B9`,
       24 slots at `$70:0F00`) or the **special-sprite** table (`$1BA`-`$1F4`,
       4 entries at `$7E:0C04`) -- the spawn loop branches on `SBC #$01BA`.
       A record **never** allocates an ambient-sprite slot: the 16-slot ambient
       table (`$70:0EC0`) is runtime-only, filled by `CODE_spawn_ambient_sprite`
       (sprite handlers, player code, GSU, tile-stamping), not the level stream.
       The `$1BA`-`$1F4` numbers coincide with ambient IDs but, as level data,
       mean the *special* sprite, not the ambient one (e.g. `$1BA` = graphic/
       palette changer, not water splash -- see `spritestateengine.md` §4.1).
       Sprite ID range is `$000`-`$1F4` for in-game (with `$1AA`-`$1B9`
       boss-related, `$1BA`-`$1C9` graphic/palette swap triggers, `$1CA`-`$1F4`
       auto-scroll controllers + sprite generators) and `$232`-`$244` for
       intro-cutscene-only sprites.

7. Game-mode $0F (Bank01 gm0f_run_level, $01:....)
   The in-level main loop. Per frame: tick player, sprites, BG layers, HDMA,
   collisions, exit-tests. Detailed in S2 below.

8. Game-mode $10 / $11 / $12 (Bank01 / Bank00)
   Victory / death / restart paths -- transition back through fades to gm$22.

9. Game-mode $13-$15 (Bank0F)
   Retry-screen prompt after all-lives-lost. See Bank0F gm13/gm15 handlers.
```

Anytime a level transition happens via a screen-exit (pipe, door, water),
the flow returns to **stage 4** (gm$0C) with `!r_level_load_type > 0` so the
entrance data is sourced from the live exit table at `$7F:7E00,x` rather
than the world-map tile.

---

## 2. The level-mode dispatcher (Bank0F context)

Bank0F is the **per-frame engine for cutscene/retry gamemodes** and the
**boss-state-machine bank**. It is also (on V1.1 builds) the home of the
level-data pointer table. The relevant per-frame gamemode handlers in this
bank are paired pairs of (load, tick):

| Mode | Phase | Handler           | What it does |
|------|-------|-------------------|--------------|
| `$05` | load  | `gm05_load_cutscene` (`$0F:BDBE`) | One-shot scene setup: loads cutscene GFX bundle `#$0079`, palette `$50`, HDMA channels $03-$07, IRQ at HCOUNT=$50/VCOUNT=$C6, timer `$1405=$3100`. |
| `$07` | tick  | `gm07_cutscene` (`$0F:BEBA`) | Per-frame: DEC `$1405` until 0 or Start/Select pressed -> advance to `$08`. Otherwise tick cutscene script (CODE_0FCC6F + DATA_0FCF2D timeline), kick FX-blob 089067 / 08B1EF. |
| `$13` | load  | `gm13_prepare_retry_screen` (`$0F:BB7A`) | Loads retry-screen GFX bundle `#$006E`, palette `$4A`, BG1-only mask, spawns 4 letter-balloon sprites at hardcoded coords, stops music. |
| `$15` | tick  | `gm15_retry_screen_cutscene` (`$0F:BC66`) | Per-frame: ticks sprites, runs FX-blob 08B1EF (heart-balloon letters). On continue-selected ($0B4C set) -> $3F (game-over) or $32 (midring restart) or $3A (level restart) based on lives + middlerings. |

The boss state machines in Bank0F are wholly contained per-sprite; they don't
participate in the gamemode dispatch at all -- they run as sprites *inside*
gm$0F when their respective level is loaded:

- **Sprite $03C "Tap-Tap the Red Nose"** -- spawned in level $3F TapTapTheRedNosesFort.
  Init at `$0F:9C0B`, main at `$0F:9C58`, 18-state ptr table at `DATA_0F9DC9`.
- **Sprite $00C "Raphael the Raven"** -- spawned in level $37 RaphaelTheRavensCastle
  (the W5-8 castle, despite the "world 6" name). Init at `$0F:AD1F`, main at
  `$0F:AD27`, two ptr tables: `DATA_0FAE54` (init/pre-fight, 10 entries) and
  `DATA_0FB282` (main combat, 21 entries).
- **Sprite $05A "Raphael Spark Attack"** -- the boss-summoned projectile, init
  at `$0F:ABD3`, main at `$0F:ABE5`.

See `S4 Per-boss state machine examples` below for the full state tables.

---

## 3. The level pointer table (the hinge of the pipeline)

This table is documented from the data side in
`yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm`. Recap:

- 222 entries, 6 bytes each: `dl object_ptr, sprite_ptr`.
- Indexed by the **level-data ID** byte `× 6`. That byte is *not* `$7E:021A`
  directly — `$021A` (`!RAM_YI_Level_CurrentLevelFromMapLo`) is a world-map
  **tile-slot ("translevel") index**, and reaching the Ptrs row from it takes a
  two-stage indirection (`level_entrance_indexes` → `map_level_entrances` byte
  +0). The level-data ID is byte +0 of the resolved entrance record (fresh entry
  / midring restart) or byte +0 of the live exit table `$7F:7E00,x` (screen-exit
  warp). It equals the `!Define_YI_LevelID_*` value of the level being loaded.
- Lives at **`$17:F7C3`** on V1.0 (`YI_USA1.sfc`) or **`$0F:E822`** on V1.1
  (`YI_USA2.sfc`). Version gated by `!ROM_YI_U2` in the `%DATATABLE_*` macro.

The emission points:

| File | Line | Address | Build |
|---|---|---|---|
| `yi/Banks/Bank17.asm` | end-of-bank `if/else` | `%DATATABLE_*($17F3E7)` | V1.0 (else branch) |
| `yi/Banks/Bank0F.asm` | end-of-bank `if/else` | `%DATATABLE_*($0FE446)` | V1.1 (if branch) |

The two emission sites are mutually exclusive -- only one runs per build,
and the un-used bank fills its share of bytes with either `FREE_BYTES` (V1.0
Bank0F is all `$FF`) or `InsertGarbageData` (V1.1 Bank17 ships the original
cart's `FF FE FE ...` padding bytes recovered from the dump).

The macro emits 5 sub-tables in sequence (offsets relative to base):

| Offset | Label                           | Size | Purpose |
|--------|----------------------------------|------|---------|
| `+$000` | `level_entrance_indexes`        | 138 B (69 words) | maps a world-map tile slot (translevel index in `$021A`) to a byte offset into `map_level_entrances`. Unused tile slots map to `$0000` (record 0). |
| `+$08A` | `map_level_entrances`           | 56 records × 4 B | per-tile entrance data: `+0` level-data ID (`×6`→`Ptrs`), `+1` X (`×16`), `+2` Y (`×16`), `+3` progression target (next tile-slot). |
| `+$16A` | `level_midway_entrance_indexes` | 138 B (69 words) | Same shape as the first index, but indexing the midway-warp table (midway lookup adds `CheckpointReentryPage × 4`). |
| `+$1F4` | `map_level_midway_entrances`    | 122 records × 4 B | Midpoint (post-checkpoint) re-entry data: `+0`/`+1`/`+2` as above, `+3` = player entrance-state (**not** a progression target). |
| `+$3DC` | `Ptrs:` (level_pointer_table)   | 222 × 6 B | THE table itself. Each row = (object_data_ptr, sprite_data_ptr). |

The level-loading code in **Bank01 gm$0C** (`gm0c_level_fadein_and_name` at
`$01:AF90`) indexes these tables as follows (framework code, fresh-entry path
`CODE_01AFA4` → shared tail `CODE_01B084` = `CODE_load_level_data_pointers`).
Note that it is record **byte +0**
that feeds the Ptrs lookup — byte +3 is read by a *different* routine
(`CODE_17A871`, the post-clear progression) and is never touched here:

```asm
; --- CODE_01AFA4: translevel -> entrance record ---
LDA.w !RAM_YI_Level_CurrentLevelFromMapLo   ; $7E:021A = world-map tile-slot (translevel)
ASL A                                       ; word index
TAX
LDA.l level_entrance_indexes,x              ; -> entrance-record byte offset
TAX
LDA.l map_level_entrances+$01,x : ...×16    ; +1 = entrance X  -> Player.X
LDA.l map_level_entrances+$02,x : ...×16    ; +2 = entrance Y  -> Player.Y
LDA.l map_level_entrances+$00,x             ; +0 = LEVEL-DATA ID (the Ptrs key)
JMP CODE_01B084
; --- CODE_01B084: level-data ID -> Ptrs row (shared with the screen-exit path,
;     which arrives here with A = byte +0 of the live exit table $7F:7E00,x) ---
AND #$00FF
ASL A : STA $00 : ASL A : ADC $00           ; X = level_data_id × 6
TAX
LDA.l Ptrs+$00,x : STA !RAM_YI_Level_LevelDataPtrLo    ; object ptr LO word
LDA.l Ptrs+$01,x : STA !RAM_YI_Level_LevelDataPtrHi    ; object ptr HI + low byte
LDA.l Ptrs+$03,x : STA !EXRAM_YI_Level_SpriteDataPtrLo ; sprite ptr low word
LDA.l Ptrs+$05,x : STA !EXRAM_YI_Level_SpriteDataPtrBank
```

`gm38` (intro storybook, Bank10 `CODE_10DA33`) runs the identical
`F3E7 → F471 byte +0 → Ptrs` path with a hardcoded translevel (`$0A`), and the
midring-restart path (`gm35` → re-entry through `gm0C` with `$038C` set) reaches
`CODE_01B084` via the live exit table `$7F:7E00,x`.

After this, `JSL unpack_level_header` (Bank10 $10:8B15) bit-extracts the
10-byte header (15 fields: background color, BG1/BG2/BG3 tileset+palette,
sprite tileset+palette, level mode, animation tileset+palette, BG scroll
rate, music, item memory; field widths summarised in
`docs/leveldataengine.md` §2) into 15 RAM fields starting at
`!RAM_YI_Level_LevelHeaderBackgroundColorLo = $7E:0134`. The bit widths are
read from `HeaderBitLengthTable` at `$10:8B05` -- 15 bytes + a `$00`
sentinel, identical to the table at PC `$080B05` in the cart.

**Why two parallel sub-tables (`*_indexes` + `map_level_entrances`)?** The
world-map tile slots are sparse (worlds have gaps in their tile grid where
no level lives), so the index table acts as a perfect-hash from
tile-slot-position to a packed record-list. World 1 has 11 entries packed
into 12 reserved tile slots; the index table maps each tile-position to its
record offset, and unused slots map to `$0000` (the first entry, which is
always a valid header to absorb stray accesses).

**What is record byte +3 (the `!Define_YI_LevelID_*` field)?** In
`map_level_entrances` it is the **world-map progression target** — the
tile-slot the Yoshi token advances to after this level is cleared. It is read
*only* by `CODE_17A871` (the post-clear overworld-progression routine), which
stores it into `$021A` and uses it to index `LevelClearFlags` and recompute the
current world. Because byte +0 is a raw number and byte +3 carries the symbol,
the `!Define_YI_LevelID_*` name on each `db` line in the DATATABLE actually
names the *next* level (the progression target), not the level that record
loads — a long-standing source of off-by-one confusion in the annotations.

**Why a separate `map_level_midway_entrances`?** A level can be re-entered
from its midpoint (checkpoint ring) after a death, in which case the player
spawns at the midway X/Y rather than the stage-intro X/Y. The midway data
lives in the second 4-byte sub-table, indexed by the second index table plus a
`CheckpointReentryPage × 4` addend (one record per checkpoint page). Its
byte +3 differs from the entrance table: it is the **player entrance-state**,
staged through the live exit table (`$7F:7E03`) into
`!EXRAM_YI_Player_CurrentStateLo`, not a progression target.

**Screen-exit re-entry (pipes / doors / water).** When `gm0C` is entered with
`$038C ≠ 0` it takes the re-entry path instead of the world-map path:

| Routine (alias) | Role |
|---|---|
| `CODE_01B01B` `level_reentry_dispatch` | Branch on `$038C`: `1` → screen-exit (below); `≥2` → entrance already staged (e.g. `gm35` midring restart), skip to header load. |
| `CODE_01B029` `apply_screen_exit_destination` | `LDX $038E` (`CurrentScreenExit`) → read the fired exit from the **live exit table** `!RAM_YI_Level_ScreenExitTable` (`$7F:7E00`, 4 B/region: dest level-data ID, X, Y, state). Destination IDs `$DE+` are **bandit-minigame triggers** (`gm$2E`, index `(dest−$DE)×2`), not levels. |
| `CODE_01B05A` `set_player_entrance_from_exit` | Normal level: seed Player.X/Y (`×16`) + entrance state from exit bytes `+1/+2/+3`, then fall through. |
| `CODE_01B084` `load_level_data_pointers` | Shared tail: exit/entrance byte `+0` (level-data ID) `×6` → `Ptrs`. |

The live exit table itself is built by the object-stream parser at level load
(stage 6 above): the screen-exit list is parsed into `$7F:7E00`, 4 bytes per
screen region (`docs/leveldataengine.md` §3 covers the on-disk exit stream).

---

## 4. Per-boss state machine examples

### 4.1 Tap-Tap the Red Nose -- sprite `$03C`

Spawned in level `$3F TapTapTheRedNosesFort` (W6-4). Init at `$0F:9C0B`
seeds: SuperFX render slot `$2280` (`$6FA2,x`), Y-offset `+$10` so sprite
spawns inside the lava bowl, initial X `$0058` (`$1064`), hp counter `$15`
(`$7402,x`), intro-freeze timer `$40` (`$7A96,x`). If the current level
matches, fires SoundID `$42` (boss-fanfare) via `CODE_0CE5D6`.

Main at `$0F:9C58` dispatches via the 18-entry pointer table at
`DATA_0F9DC9` (`tap_tap_state_ptr`), indexed by `$105F << 1`. State byte
`$105F` is updated by individual handlers; transitions follow the natural
"intro -> normal AI -> damaged -> death" lifecycle:

| State | Phase | Handler | Behavior |
|-------|-------|---------|----------|
| `$00` | intro | `CODE_0F9DED` | Tiny (pre-boss) idle; on level == TapTap's-Fort kicks Kamek to start cinematic. |
| `$01` | intro | `CODE_0F9E37` | Kamek talking (paused listening to Kamek's quip). |
| `$02` | intro | `CODE_0F9E60` | Hops up, grows in size, rotates around center. |
| `$03` | intro | `CODE_0F9EC6` | Centers + falls down toward the player's platform. |
| `$04` | intro | `CODE_0F9EF4` | Pauses on landing, awaits player approach. |
| `$05` | AI    | `CODE_0F9F29` | Walks forward (chases player X via `$1064`). |
| `$06` | AI    | `CODE_0F9FD4` | Turns around when X overshoots / edge hit. |
| `$07` | AI    | `CODE_0FA058` | Prepares to jump (animation wind-up). |
| `$08` | AI    | `CODE_0FA0C4` | Airborne (jumping). |
| `$09` | AI    | `CODE_0FA12A` | Landed from jump (resume walk). |
| `$0A` | damaged | `CODE_0FA14D` | Knocked back from egg hit. |
| `$0B` | damaged | `CODE_0FA1B8` | Initially being egg-hit (impact frame). |
| `$0C` | damaged | `CODE_0FA230` | Falling from egg hit in air. |
| `$0D` | damaged | `CODE_0FA318` | Hobbling off-balance after egg hit. |
| `$0E` | death  | `CODE_0FA383` | Dying: sinking in lava (head-bop kill triggers this). |
| `$0F` | death  | `CODE_0FA515` | Rising in lava (mouth open/close convulsions). |
| `$10` | death  | `CODE_0FA56A` | Submerging completely. |
| `$11` | death  | `CODE_0FA5BF` | Final explosion -> `JML CODE_03A31E` (sprite-despawn). |

**Head-bop trigger:** at the top of `main_tap_tap_the_red_nose`, `$7862,x ==
$18` (set by the hit-test routine in Bank03 `$03:AF23`) detects a Yoshi
head-bop. Plays SoundID `$7A` (HurtNepEnut), stops music, masks SuperFX
render flags, and sets `$105F := $0E` -- jumping straight to the death
sequence regardless of remaining hp. Egg hits go through `CODE_0FB243`
(intra-bank hit-test in Bank0F), which routes to states `$0A`-`$0D`
depending on whether the boss is on-ground, jumping, or already hurt.

**No HDMA tricks** for Tap-Tap -- he's rendered purely via SuperFX rotation
on FX-blob `FXCODE_088B49` calls (the same blob Raphael uses; both bosses
share the rotation/scale pipeline).

---

### 4.2 Raphael the Raven -- sprite `$00C`

Spawned in level `$37 RaphaelTheRavensCastle` (W5-8). Init at `$0F:AD1F`
delegates to `CODE_0FB0B6` which seeds: alive-flag `$7402,x = 1`,
spark-spawn flags at `$60A8/$60B4` cleared, GSU counter `$0CF9` cleared,
SuperFX render slot armed, level-mode == 9 (moon-stomp camera) detection.

Main at `$0F:AD27` is split-flow:

```
If header LevelMode == 9 (in the actual boss room):
    JSL CODE_01B403           ; tick Raphael moon-camera (Bank01)
    Then SuperFX render via FX-blob 088B49 (init phase) or 088205 (combat).
    Then JSR CODE_0FB14B      ; dispatch via raphael_main_ptr (combat AI)
Else (pre-fight cinematic):
    SuperFX render via 088B49 always.
    Then JSR CODE_0FAE12      ; dispatch via raphael_init_ptr (cinematic)
```

**Raphael's "init" state pointer table (pre-fight cinematic, 10 entries):**

| State | Handler | Behavior |
|-------|---------|----------|
| `$00` | `CODE_0FAE68` | Walking down the right wall (descending into the arena). |
| `$01` | `CODE_0FAE88` | Rotating at the corner of the arena. |
| `$02` | `CODE_0FAEA1` | Walking left toward Yoshi. |
| `$03` | `CODE_0FAECB` | Pausing (anticipation beat). |
| `$04` | `CODE_0FAEF3` | Waiting on Kamek to finish exposition. |
| `$05` | `CODE_0FAF24` | Trembling, about to grow. |
| `$06` | `CODE_0FAF75` | Growing + doing a flip (sprite scale animation). |
| `$07` | `CODE_0FAFCF` | Stomping on ground (pre-fight final stomp). |
| `$08` | `CODE_0FB005` | Lunging at Yoshi. |
| `$09` | `CODE_0FB0B4` | Stop, wait for Yoshi to fly offscreen (transition out of init). |

State byte for this table is `$18,x` (`!RAM_YI_Level_NorSpr_GenericTable701800`).
Selector at `CODE_0FAE19`: `LDA $18,x : ASL : TAX : JMP (DATA_0FAE54,x)`.

**Raphael's "main" state pointer table (combat / damage / death, 21 entries):**

| State | Phase | Handler | Behavior |
|-------|-------|---------|----------|
| `$00` | intro | `CODE_0FB31A` | Yoshi flying up to moon (camera intro). |
| `$01` | intro | `CODE_0FB337` | Yoshi falling onto initial platform. |
| `$02` | intro | `CODE_0FB363` | Camera pans down, Raphael moving in background. |
| `$03` | intro | `CODE_0FB391` | Flying up to the moon (player's POV). |
| `$04` | intro | `CODE_0FB425` | Turning around (Raphael's POV). |
| `$05` | main  | `CODE_0FB4A5` | Moving forward. |
| `$06` | main  | `CODE_0FB523` | Stomping down on the moon (creates spark hazards). |
| `$07` | main  | `CODE_0FB53C` | Turning around to choose direction. |
| `$08` | main  | `CODE_0FB581` | Preparing to move (decision tick). |
| `$09` | attack | `CODE_0FB67A` | Hopping up to initiate attack. |
| `$0A` | attack | `CODE_0FB694` | Pounding down + shooting flames (spawns sprite $05A sparks). |
| `$0B` | damaged | `CODE_0FB5D4` | Damaged from stake ground-pound. |
| `$0C` | damaged | `CODE_0FB633` | Stunned (after Yoshi head-bopped him while flipped). |
| `$0D` | death | `CODE_0FB6C9` | Final stake pound, dying. |
| `$0E` | death | `CODE_0FB733` | Turning slightly from death spot. |
| `$0F` | death | `CODE_0FB76E` | Rotating/scaling back up to the sky. |
| `$10` | death | `CODE_0FB7BD` | Rotating/fading into a twinkle. |
| `$11` | death | `CODE_0FB833` | Twinkle fading out. |
| `$12` | death | `CODE_0FB84D` | Star forming (constellation sprite spawn). |
| `$13` | death | `CODE_0FB866` | Constellation fade-in. |
| `$14` | done  | `CODE_0FB8DB` | Done with fight, final state (waits for level-exit). |

State byte is `$105F` (`!RAM_YI_Level_NorSpr_GenericTable70105F` mirror).
Selector at `CODE_0FB2AC`: damage gate inspects `$0D07` (egg-hit flag) and
`$105D` (Raphael's polar angle on the moon) to decide whether the hit
counts; on accepted hit, transitions state to `$0D` (death pound) when
`$701900,x == 1` (final stake placed) or `$0B` (regular damage) otherwise.

**HDMA tricks:** Raphael's fight uses the **moon-stomp camera** which is a
LevelMode 9 routing (set by `gm0C`'s `.level_mode_checks` block in Bank01,
which calls `load_levelmode_09_settings` at `$01:B0E5`). This installs a
custom HDMA channel set + the special BG3 tilemap that wraps in a circle
around the moon. The SuperFX rotation FX-blob (`FXCODE_088B49`) does the
per-frame matrix solve to keep Raphael's polar coordinates rendering
correctly as he walks around the spherical surface.

**Spark attack mechanics:** state `$0A` spawns sprite `$05A` (Raphael Spark
Attack) via `CODE_0FAC61`, which fires 3 sparks per attack using
`CODE_03A364` (spawn-secondary-sprite helper). Each spark gets its own
position offset (`DATA_0FAC59` / `DATA_0FAC5D` left/right pairs) and
animates per a 9-frame curve in `DATA_0FABDC`.

---

## 5. The level-mode dispatcher (full per-frame routing in mode `$0F`)

Game mode `$0F` is the player-control "in-level" mode. Once the level loader
hands off (stage 6 above), the per-frame loop runs `gm0f_run_level` in
Bank01 (`$01:....`). The per-frame work is:

```
1. Player tick (Bank02/03/04 -- player state machine, joypad, item-use)
2. Sprite tick (Bank0F/...) -- spawn pending, init+main per active slot
3. BG layer scroll + tilemap fetch (Bank10/Bank11)
4. HDMA table updates (gradient, water, parallax)
5. Map16 stamping (Bank13) -- per visible Map16 cell
6. OAM emit + GSU job dispatch (Bank03)
7. Collision tests (player vs sprite, sprite vs sprite, player vs Map16)
8. Screen-exit polling (lookup $7F:7E00,x for current screen)
9. Pause / message-box / item-menu detection
10. HUD update
```

The per-mode dispatch INSIDE gm$0F is driven by the level's **LevelMode**
field (header field 10, 5 bits). LevelMode selects which scene-register
preset is installed at level-load (Bank01 `gm0c .load_palette` block):

- **`$00`-`$08`** standard side-scrolling levels; routed through generic gm$0F.
- **`$09`** Raphael the Raven boss room (moon-stomp camera). Routes through
  `load_levelmode_09_settings` at level-load, then gm$0F branches via
  Bank01 `CODE_01B403` per-frame.
- **`$0A`** Kamek autoscroll mode (used for the kart segments + Kamek's
  Revenge). Routes through `load_levelmode_0A_gfx` + `load_levelmode_0A_palettes`
  at load, then standard gm$0F with the autoscroll camera in Bank01.
- **`$0B`-`$1F`** various special modes (Bowser fight, ending sequences,
  bonus-room layouts). Less common; specific handlers checked into Bank01.

Within gm$0F there's no further explicit "level-mode dispatcher" -- the
LevelMode flag flows down to per-sprite, per-camera, and per-render handlers
via the scene-register preset and per-flag branches in the code paths that
read `!RAM_YI_Level_LevelHeaderLevelModeLo` ($7E:0146).

---

## 6. Cross-references

### Framework asm (source of truth)
- `yi/Banks/Bank17.asm` -- gm22_overworld, level_select, world_map_state_ptr,
  the V1.0 level-pointer-table emission point.
- `yi/Banks/Bank0F.asm` -- gm05/07/13/15 cutscene + retry handlers, Tap-Tap
  + Raphael state machines, the V1.1 level-pointer-table emission point.
- `yi/Banks/Bank01.asm` -- gm0c_level_fadein_and_name (the level-data
  staging point), gm0d/gm0e (post-pipe entry + fade-in), gm0f_run_level
  (the in-level main loop).
- `yi/Banks/Bank10.asm` -- UnpackLevelHeader + LoadLevelData (the object-
  stream parser; downstream side documented in docs/leveldataengine.md).
- `yi/Banks/Bank00.asm` -- game_mode_pointers (the 69-entry gamemode
  dispatch table at `$00:8197`).
- `yi/Routines/DATATABLE_YI_LevelDataPtrsAndEntranceData.asm` -- the
  level-pointer-table macro itself, with per-entry annotations for all 222
  Ptrs: entries.
- `yi/Constants/LevelIDs.asm` -- the `!Define_YI_LevelID_*` symbol set
  (53 named slots covering the 6 worlds + Special).
- `yi/Memory/WRAM_GameMode_Header.asm` -- the 15 level-header mirror
  fields populated by UnpackLevelHeader.
- `yi/Memory/WRAM_LevelState.asm` -- per-level state vars ($7E:0212-$7E:03BE).

### Sibling docs in this folder
- `docs/leveldataengine.md` -- the downstream object-decode pipeline
  (Bank10 master parser, Bank12 dispatch tables and walker, Bank13
  per-cell stamp handlers). Also covers the level-data format
  (header bit layout, object/sprite/exit streams) and the MAP16 system.
- `docs/enginecore.md` -- Bank `$00` engine: gamemode dispatcher (the 69
  per-mode handlers), graphics + palette loaders, NMI/IRQ, fades.
- `docs/bossengine.md` -- per-boss state machines that run as sprites
  inside gamemode `$0F` once the level is loaded.
- `docs/spritestateengine.md` -- the per-sprite state engine in Bank03.

### External references
- `yoshisisland-disassembly/disassembly/bank17.asm` -- 4% descriptive;
  provides labels: `gm_load_title_screen`, `gm20_prepare_overworld`,
  `gm22_overworld`, `gm24_overworld_level_progression`, `gm26_level_score_update`,
  `gm28_world_score_flip_cutscene`, `level_select`, `world_map_state_ptr`,
  `level_entrance_indexes`, `map_level_entrances`, `level_object_pointers`,
  `level_sprite_pointers`, plus per-state animation labels.
- `yoshisisland-disassembly/disassembly/bank0F.asm` -- 14% descriptive;
  provides ~108 labels for sprites + gamemode handlers.
- `yoshisisland-disassembly/disassembly/bank00.asm` -- 30%+ descriptive;
  the `game_mode_pointers` table at `$00:8197` documents all 69 gamemodes
  by name.
- `yoshisisland-disassembly/disassembly/bank01.asm` --
  `gm0c_level_fadein_and_name`, `gm0d_level_fadein_post_pipe_or_door`,
  `gm0f_run_level`, the prepare_in_level_states helper, `levelmode_index`.
- `yoshisisland-disassembly/docs/named_main_labels.txt` -- searchable
  index of all named labels.

### See also
- `ys_play.asm` -- player-side level-entry handlers (entrance X/Y, spawn
  state, midway-ring respawn path).
- `ys_main.asm` -- main loop and per-frame entry (the upstream side of
  the gm$0F dispatch chain).
- `ys_game.asm` -- gamemode-state dispatcher reference (mirrors the
  framework's $1E/$1F/$0B/$0C/$0D/$0E/$0F transition chain).
- `ys_mapdt.asm` -- world-map / level-entrance data tables (parallel to
  the framework's `level_entrance_indexes` + `map_level_entrances`).
- `ys_w11.asm`..`ys_w70.asm` -- per-level data files (one per world+level
  slot; parallel to the framework's per-level `.bin` files referenced by
  the `Ptrs:` table).

---

## 7. Known glitches and special-case levels

- **Record `$38` is the gm38 intro-cutscene level** (played by world-map
  slot `$0A`). It was long misglossed "KameksRevenge" -- that name is the
  map-slot (translevel) `$38` = 5-Extra, whose record is `$2C`; the
  `!Define_YI_LevelID_*` values are map slots, not records. Record `$38`'s
  streams are real but minimal (66-byte backdrop + empty sprites; the
  cutscene engine drives the actors).
- **The `$DA`/`$DB` `Ptrs:` rows are sentinels, not real levels** -- they
  hold garbage bytes. Enumerate levels via the entrance tables, not by
  walking the pointer table or the `!Define_YI_LevelID_*` set.
- **Records $19 (3-8 "Naval Piranha's Castle") and $CB (a sub-room)** have
  their sprite-data pointers biased by `-2` (`dl DATA_*,DATA_*-$02`). This is a
  vestigial header-layout anomaly preserved from the original cart and
  documented in DATATABLE_YI_LevelDataPtrsAndEntranceData.asm. The bare
  anchor labels (`DATA_14C6C6:` in Bank14, `DATA_16F097:` in Bank16) are
  zero-byte aliases so the arithmetic resolves at build time; the actual
  sprite-stream bytes live inside the *previous* extracted slice
  (`DATA_14C5D9.bin` at offset $EB for $19; `DATA_16F091.bin` at offset $04
  for $CB). Downstream extractors that look up a `.bin` by name must
  resolve `LABEL-$N` to a cart address and locate the encompassing slice.
- **Two id spaces, historically conflated in this tree's comments.**
  `!Define_YI_LevelID_*` values are world-map SLOTS (translevels,
  `CurrentLevelFromMap`); `Ptrs:` rows are level-data RECORDS. They agree
  numerically only for 1-1..1-7 and diverge from slot $07 on (1-8's tile
  plays record $9B). The per-row glosses in the DATATABLE Ptrs block and
  the per-define glosses in LevelIDs.asm are now derived from the cart
  entrance tables (the level map) and state both ids
  explicitly; older revisions glossed records with slot names. See the
  LevelIDs.asm header ID-SPACE WARNING ("two ID spaces — never conflate").
