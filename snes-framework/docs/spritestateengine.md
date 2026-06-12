# YI sprite state engine reference

A standalone reference for the Yoshi's Island per-sprite state machine: how
every normal-sprite slot in the game is ticked once per frame, dispatched to
one of nine engine-side state handlers, and from there into the per-sprite
Init / Main / HeadBopped / RideYoshi handler indexed by sprite ID.

This is the **lowest-layer** sprite engine; bosses (see `docs/bossengine.md`)
and individual sprites all layer their own per-sprite state machines on top
of this one.

This doc complements:

- `docs/bossengine.md` -- the boss state machine layered on top of THIS engine.
- `docs/leveldataengine.md` -- how sprite slots are allocated from the level's
  sprite-spawn list.
- `docs/levelloader.md` -- the gamemode chain that runs before the
  per-frame sprite tick starts (sprite ID ranges summarised in §1 of
  that doc).

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank03.asm` (the engine bank). Cross-verified against
`yoshisisland-disassembly/disassembly/bank03.asm` (descriptive labels) and
the parallel engine source `ys_enmy.asm`.

---

## 0. Cross-bank 65816 conventions (read this first)

A handful of 65816 calling and addressing conventions recur across every
sprite Main, boss state handler, level-data walker, and helper called by the
sprite engine. They aren't sprite-engine-specific in isolation, but the
sprite engine sets them up and assumes them everywhere — reading sprite
code without these in mind is hard.

This preface is the briefer for them. If you've already internalised these
from reading enginecore.md / leveldataengine.md / a few family-*.md
docs, skip to §1.

### 0.1 X = current sprite-slot index

The 65816 X register holds the **byte offset into the 24-slot normal-sprite
table** for the slot currently being processed. Slots are 4 bytes apart, so
valid X values are `0, 4, 8, ..., $5C`. Every per-slot field accessed via
`,x` indexing assumes this convention.

For the 16-slot ambient-sprite table (`$70:0EC0+`), the engine flips into a
different X range (4-byte stride, base offset $80) for the duration of the
ambient-sprite tick. Family docs note this when relevant; sprite Mains
themselves never see ambient X values.

When code uses `Y` for a slot index instead of `X`, it's almost always
because the code is **spawning or referencing a *different* slot from its
own** — most commonly: parent reading child's fields, helper that received
the "other slot" via Y, or a spawn helper that returns the new slot's index
in Y. The own-slot index lives in X throughout.

### 0.2 `LDX.b $12` slot-restore

Direct-page `$12` (16-bit) caches the current slot's X. Any helper that
might trash X must restore from here on return. The pattern in sprite code:

```asm
JSL.l CODE_xxxxxx          ; helper that uses X for its own purpose
LDX.b $12                  ; restore X to "my slot"
LDA.w !EXRAM_YI_Level_NorSpr_SomeField|!EXRAMBankMirror,x   ; continue
```

If you read a sprite Main and the X register's value seems suddenly wrong,
look for a recent JSL — the called helper either (a) restored X itself
(common for the small/atomic helpers in Bank03), or (b) didn't, and a
`LDX.b $12` should appear shortly after. When neither has happened, the
bug is real.

### 0.3 `TXY` preserve-slot

When sprite code calls a helper that takes the slot via Y instead of X
(`CODE_spawn_sprite`, `CODE_03A858` player-hit, several SuperFX-handoff
helpers), the caller writes `TXY` immediately before to make Y match X.
The helper then operates on the same slot through Y. Often paired with
`LDX.b $12` after the call to restore X if the helper trashed it.

The inverse — `TYX` — is the standard prologue for any helper invoked with
Y = slot when it needs to use X-indexed addressing locally.

### 0.4 Cross-bank `JSL` / `RTL` calling

Sprite Mains live in Bank `$03/$04/$05/$06/$07/$0C/$0D/$0E/$0F` (and a few
elsewhere). The engine's per-sprite dispatch (§4) does the long-call to the
right bank via a 24-bit pointer tail-JMP — so the sprite handler starts
with DBR = its own bank.

Within a sprite Main, calls to helpers in other banks use `JSL.l` (24-bit
long call). The helper ends with `RTL` (return long). DBR is generally
preserved by the helper (it doesn't change banks halfway through).

`JSR.w` / `RTS` (16-bit short call) is used for in-bank calls only.

### 0.5 `!EXRAM_*|!EXRAMBankMirror,x` addressing

YI splits per-slot sprite state across two RAM regions:

- **WRAM** (`$7E:xxxx` + Direct Page mirror): global engine state and
  sprite *bookkeeping* slots that the SNES CPU touches every frame.
- **EXRAM** (cart SRAM at `$70:xxxx`): per-sprite *content* fields
  (position, velocity, sprite-ID, sub-state bytes, generic table bytes).

Per-slot EXRAM fields are addressed as:

```asm
LDA.w !EXRAM_YI_Level_NorSpr_<FieldName>|!EXRAMBankMirror,x
```

The `|!EXRAMBankMirror` part is the asar-side trick that resolves the base
address into the correct LoROM mirror bank. Without it, the assembler emits
a bank that doesn't actually reach the cart SRAM. **You will see this
construct on essentially every line of sprite Main code; read it as "load
the per-slot field from EXRAM."**

Defines live in `yi/Memory/SRAM_SpriteSlots.asm`. The most common fields
(documented per-byte in family-*.md and round 5+6 work):

| Define | Bytes | Field |
|---|---|---|
| `_SpriteID` | 2 | sprite ID, indexed at $7E:1320 / $70:1320 |
| `_CurrentStatus` | 2 | state byte ($02/$10/etc. -- see §2) |
| `_XPositionLo`/`Hi` | 4 | 24-bit X position |
| `_YPositionLo`/`Hi` | 4 | 24-bit Y position |
| `_XSpeedLo`/`Hi` | 4 | 24-bit X velocity |
| `_YSpeedLo`/`Hi` | 4 | 24-bit Y velocity |
| `_GenericTable701900` / `701902` | 2 ea. | per-slot scratch bytes (used heavily for variant encoding -- see §10.2) |

### 0.6 REP / SEP widths

`handle_sprite` sets M=16 X=16 (REP #$30) before dispatching to a per-sprite
Main. Every per-slot field is 16-bit, so sprite code stays in 16-bit
accumulator + 16-bit index mode throughout.

A handful of helpers (palette-index lookups, byte-stream readers, single-byte
status flag reads) temporarily SEP #$20 to read an 8-bit value, then REP
back. They restore by the time they return.

The handful of `LDA.b` / `STA.b` 8-bit immediates you'll see in sprite code
are reading a single byte from EXRAM into the low half of the 16-bit
accumulator; the high half is undefined and is masked off before any
arithmetic.

### 0.7 Direct-page conventions

`handle_sprites` sets `DP = $7960` before per-slot dispatch. So when a
sprite Main does `LDA.b $76,x` (a 1-byte DP-indexed-by-X load), it's
loading from `$7960 + $76 + slot_offset` = `$79D6 + slot_offset` and
adjacent — landing in the per-slot sub-state byte region.

Common direct-page slots referenced by sprite code (relative to DP = $7960):

| DP offset | Field |
|---|---|
| `$00..$0E` | 8 scratch words (16-bit), caller-owned across in-bank JSR |
| `$10..$11` | usually engine scratch (free in sprite-side) |
| `$12..$13` | **slot index X (restore via `LDX.b $12`)** -- the §0.2 convention |
| `$14..$1F` | further scratch + occasional helper-private slots |
| `$76,x` / `$77,x` | per-slot combat-state byte (main state) |
| `$16,x` / `$17,x` | per-slot sub-state byte (nested step counter) |
| `$18,x` / `$19,x` | per-slot init-state byte / variant index |

The `$76,x`, `$16,x`, `$18,x` triumvirate is the per-sprite state-machine
substrate. Most family docs describe each sprite's machine in terms of which
of these bytes it dispatches on (see "§ Where to start reading a new sprite-
family" in §10.4 for the standard reading recipe).

### 0.8 Cross-references

For the chip-side counterpart of these conventions (how the GSU-2 chip
processes bytes, dual-issue, ALT prefix state), see `docs/mchip.md` §7.

For Bank `$00` firmware that sets up the engine (boot, NMI/IRQ, palette
loaders, DMA queues, SPC upload), see `docs/enginecore.md`.

For level-data parsing that runs at level-load (before per-frame sprite
ticks start), see `docs/leveldataengine.md` and `docs/levelloader.md`.

---

## 1. Two-layer dispatch at a glance

Every active normal-sprite slot is processed by a two-layer dispatch chain:

```
Bank00 / Bank11 / etc.
   |
   v   JSL handle_sprites  ($03:97D3)
+----------------------------------------------------------------+
| handle_sprites: per-frame top-level driver                     |
|   sets DBR=$03, DP=$7960                                       |
|   per-frame SuperFX upload setup                               |
|   for each of 24 slots (LDX #$5C ; loop DEX/4):                |
|     if state byte != 0:                                        |
|       JSL handle_sprite  ($03:9A12)                            |
+----------------------------------------------------------------+
   |
   v   JSL handle_sprite (per-slot entry)
+----------------------------------------------------------------+
| handle_sprite:                                                 |
|   stash slot X/Y position into SuperFX shared                  |
|   decrement 5 per-slot countdown timers                        |
|   Y = state byte (CurrentStatus,x)                             |
|   PHA/RTS trampoline through sprite_state_routines[Y/2]        |
+----------------------------------------------------------------+
   |
   v   PHA/RTS into ONE of nine state handlers
+----------------------------------------------------------------+
| spr_state_init           ($03:9A6E)  state $02 / $04           |
| spr_state_main           ($03:9A90)  state $10                 |
| spr_state_tongued        ($03:9AC8)  state $08                 |
| spr_state_die_collision  ($03:9F8D)  state $0C                 |
| spr_state_die_burning    ($03:A00B)  state $12                 |
| spr_state_on_head_bop    ($03:A085)  state $0E                 |
| spr_state_ride_yoshi     ($03:A11D)  state $0A                 |
| spr_state_turn_star      ($03:A247)  state $06                 |
+----------------------------------------------------------------+
   |
   v   each state handler resolves PER-SPRITE pointer
+----------------------------------------------------------------+
| sprite_inits     ($03:8000)  -- 3-byte ptr, indexed by id*3    |
| sprite_mains     ($03:852E)                                    |
| head_bops        ($03:8A5C)                                    |
| sprite_ridings   ($03:8F8A)                                    |
+----------------------------------------------------------------+
   |
   v   tail-JMP via dp $00..$02 (24-bit pointer)
+----------------------------------------------------------------+
| Per-sprite handler in Bank03/04/05/06/07/0C/0D/0E/0F/10/11     |
| YI_NorSpr<id>_<Name>_Init / _Main / _StompRt / _RideYoshiRt   |
+----------------------------------------------------------------+
```

The engine's contribution is the OUTER dispatch: deciding which of the nine
state handlers to run based on the slot's state byte. The state handler
then resolves the per-sprite handler from one of four 3-byte-per-entry
pointer tables and tail-JMPs into it.

---

## 2. The state byte (CurrentStatus,x)

Each of the 24 normal-sprite slots has a 1-byte state in **EXRAM** (= cart
RAM, NOT WRAM) at:

```
EXRAM[$70:0F00 + slot]  = !EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x
```

where `slot` is `X = 0, 4, 8, ..., $5C` (4-byte stride, 24 slots), so the
state-byte addresses are `$70:0F00, $0F04, $0F08, ..., $0F5C`.

The state byte values are always **even** and in the range `$00..$12`:

| State | Meaning | Handler |
|---|---|---|
| `$00` | slot empty -- skip this slot | (none; loop condition skips it) |
| `$02` | newly spawned, run Init | `spr_state_init` |
| `$04` | newly spawned (alt) | `spr_state_init` (same handler) |
| `$06` | transforming into Super Star | `spr_state_turn_star` |
| `$08` | stuck on Yoshi's tongue | `spr_state_tongued` |
| `$0A` | riding on Yoshi's back | `spr_state_ride_yoshi` |
| `$0C` | killed by environmental collision | `spr_state_die_collision` |
| `$0E` | just bopped/stomped by Yoshi | `spr_state_on_head_bop` |
| `$10` | alive / Main running (default) | `spr_state_main` |
| `$12` | on fire (burning to death) | `spr_state_die_burning` |

Lifecycle of a typical sprite:

```
spawn   -> state $02 (or $04)
            |
            v  spr_state_init runs once: calls per-sprite Init, sets state $10
state $10 (alive)
            |
            v  spr_state_main runs every frame: calls per-sprite Main
            |
       branches:
       |  |  |  |  |  |
       v  v  v  v  v  v
     $08 $0A $0E $0C $12 $06
                                -- each state's handler ALSO calls spr_state_main
                                   internally so per-sprite Main keeps animating
                                   while the sprite is in the overlay state.
                                -- final transition is usually $00 (despawn)
                                   via despawn_sprite_stage_ID below.
```

A parallel implementation of this state byte and its 9-handler dispatch
exists in `ys_enmy.asm` (see §9 cross-reference table).

---

## 3. Engine entry points

### 3.1 handle_sprites -- per-frame top-level driver

| SNES addr | Label | Purpose |
|---|---|---|
| `$03:97D3` | `handle_sprites` | Normal entry: setup, then enter the per-slot loop. |
| `$03:97DF` | (alt entry) | Same body but also calls `CODE_039596` first (check for new offscreen sprites entering the camera). Used by gamemode `$0F` ingress paths. |
| `$03:97EC` | (shared body) | Common body both entries fall into. |
| `$03:98C5` | (per-slot loop) | `LDX #$5C` then `DEX/4` until X<0; for each slot with state != 0, JSLs `handle_sprite`. |

Both entry points start with `PHB / PHK / PLB / PHD / REP #$20 / LDA #$7960 / TCD`,
i.e. set DBR=$03 (sprite-engine bank) and DP=$7960 (so per-slot variables can be
accessed via 1-byte direct-page addressing inside sprite handlers).

Call sites across the codebase:

| Caller bank | Sites | Notes |
|---|---|---|
| Bank00 | 1 | Main per-frame loop. |
| Bank01 | 1 | Gamemode `$0F` (Hookbill/Naval-Piranha closer paths use the alt entry). |
| Bank10 | 1 | Camera-event handler. |
| Bank11 | 13 | Various game-mode dispatch sites (level-transition, cutscene, mini-game). |

### 3.2 handle_sprite -- per-slot per-frame entry

At `$03:9A12`. Called from the `handle_sprites` per-slot loop. For each
active slot:

1. Stashes pixel position into SuperFX-shared (`$6EBC` / `$6EBE`).
2. Checks the global freeze flag (`!EXRAM_YI_Level_FreezeSpritesFlagLo`),
   the fuzzy-mosaic timer, and the item-in-use flag; if any are set,
   SKIPS the four countdown timers.
3. Decrements the five per-slot timers if non-zero:
   - `$7A96,x` (timer 1)
   - `$7A98,x` (timer 2)
   - `$7AF6,x` (timer 3)
   - `$7AF8,x` (timer 4)
   - `$77C1,x` (swallowed/tongued countdown -- ALWAYS ticks)
4. Loads state byte into Y, indexes into `sprite_state_routines` at
   `$03:9A59-2` (the `-2` accounts for state values starting at `$02`),
   and uses a PHA/RTS trampoline to jump to the state handler.

### 3.3 sprite_state_routines -- the 9-entry dispatch table

At `$03:9A59`, immediately following `handle_sprite`. 9 entries, each a
`dw` of `target-1` (PHA/RTS convention):

```
$03:9A59  dw spr_state_init-1           ; state $02
$03:9A5B  dw spr_state_init-1           ; state $04  (alias, same target)
$03:9A5D  dw spr_state_turn_star-1      ; state $06
$03:9A5F  dw spr_state_tongued-1        ; state $08
$03:9A61  dw spr_state_ride_yoshi-1     ; state $0A
$03:9A63  dw spr_state_die_collision-1  ; state $0C
$03:9A65  dw spr_state_on_head_bop-1    ; state $0E
$03:9A67  dw spr_state_main-1           ; state $10
$03:9A69  dw spr_state_die_burning-1    ; state $12
```

---

## 4. The four per-sprite pointer tables

Each engine state handler (except `spr_state_die_collision`, which only
re-uses `spr_state_main`) does an indirect lookup into ONE of four tables
based on sprite ID:

| Table | Addr | Stride | Indexed by | Read by |
|---|---|---|---|---|
| `sprite_inits` | `$03:8000` | 3 bytes (`dl`) | id*3 | `spr_state_init` |
| `sprite_mains` | `$03:852E` | 3 bytes (`dl`) | id*3 | `spr_state_main` |
| `head_bops` | `$03:8A5C` | 3 bytes (`dl`) | id*3 | `spr_state_on_head_bop` |
| `sprite_ridings` | `$03:8F8A` | 3 bytes (`dl`) | id*3 | `spr_state_ride_yoshi` |

Each table has one entry per **normal-sprite ID** from `$000` to `$1B9`
(442 entries x 3 bytes = 1326 bytes per table). IDs `$1BA+` belong to two
*other* sprite systems (special and ambient) that share the same numbers but
have their own slot tables and dispatch -- see §4.1.

The convention for "this sprite has nothing to do in this slot":
- Init: point to `init_unused_rtl_stub` at `$03:9A6B` (a single `RTL`).
- Main: required -- every sprite has a real Main.
- HeadBop: point to the shared RTL at `$03:9A6B` (most sprites can't be
  stomped meaningfully).
- RideYoshi: ditto.

This explains the **huge** runs of stacked labels in Bank03.asm just before
each shared RTL -- asar accepts duplicate labels at the same address and
emits one byte for each `dl` referencing them.

### 4.1 Three sprite systems share the `$1BA+` ID numbers

The four tables above serve only **normal sprites** (`$000-$1B9`). Two other
sprite systems exist, and their IDs reuse the same numeric range -- so the same
9-bit number can mean different sprites depending on which system spawns it.

| System | ID range | Slot table | Slots | Dispatch | Spawn source |
|---|---|---|---|---|---|
| **Normal** | `$000-$1B9` | `$70:0F00` `!EXRAM_YI_Level_NorSpr_CurrentStatus` | 24 | the four tables above (init/main/headbop/ride) | level sprite stream |
| **Special** | `$1BA-$1F4` | `$7E:0C04` `!RAM_YI_Level_NorSpr_ActiveSpecialSpritesTable` | 4 words | `DATA_special_sprite_inits` (`$03:D46F`) + `DATA_special_sprite_mains` (`$03:D4E3`); init via `CODE_init_special_sprite` (`$03:979E`) | level sprite stream |
| **Ambient** | `$1BA-$244` | `$70:0EC0` `!EXRAM_YI_Level_AmbSpr_SpriteExistsFlag` (ID at `$70:1320`) | 16 | `DATA_ambient_sprite_routines` (Bank00, main-only) via `CODE_handle_ambient_sprites` | **runtime only** (`CODE_spawn_ambient_sprite`) |

**Normal vs special -- same source, different table.** Both spawn from the same
level sprite stream (3-byte records) through the same spawn loop, which branches
on the ID: `SBC #$01BA` -- below routes to a normal 24-slot allocation; at/above
calls `CODE_init_special_sprite`, which finds a free entry in the 4-word special
table and stores `SprID - $01B9` there (`$0000` = empty). The branches are
mutually exclusive, so a level record lands in **exactly one** table -- a special
sprite does *not* also occupy a normal slot. Special sprites are the auto-scroll
controllers, the graphic/palette changers, and the sprite generators; they have
**only Init + Main** (no head-bop / ride-Yoshi).

**Ambient is runtime-only and never in level data.** The 16-slot ambient table
(`$70:0EC0`, ID stored at `$70:1320`) is filled exclusively by runtime
`CODE_spawn_ambient_sprite` callers -- other sprites' handlers, player-state code,
the GSU command buffers, and level-load Map16 tile-stamping. The level loader has
no path into it. Ambient sprites are the splashes, bubbles, puffs, sparkles and
score popups (catalogued in `yi/Constants/AmbientSpriteIDs.asm`); each runs a
single Main routine until it self-despawns.

**The namespace overlap (the trap).** The special and ambient dispatch tables are
*both* indexed by `id - $1BA`, and index 0 is a different sprite in each:

| `id - $1BA` | Special (`DATA_special_sprite_inits`) | Ambient (`DATA_ambient_sprite_routines`) |
|---|---|---|
| `0` (`$1BA`) | `CODE_init_palette_spr` (BG1 graphic/palette changer) | `CODE_ambient_water_splash_transition` (water splash) |

Same byte in the ROM, two unrelated sprites; the spawn path decides which, not
the number. A `$1BA` in the level sprite stream is **always** the palette changer
(special table) -- the water-splash meaning is reachable only when runtime code
calls `CODE_spawn_ambient_sprite` with `$1BA`. So `AmbientSpriteIDs.asm`
documents the *ambient* reading of `$1BA-$1F4`; as **level-data** IDs those same
numbers are special sprites. The graphic/palette changers (`$1BA-$1C9`, all of
special-table indices 0-15) are documented in full in `renderingpipeline.md`
§1.1. See also `levelloader.md` §1 (sprite-stream spawn).

---

## 5. State handlers in detail

All nine engine handlers live in Bank03 at the addresses below. Every
handler except `spr_state_init` begins with `JSL spr_state_main`, which
re-dispatches into the per-sprite Main handler. That keeps the sprite's
animation alive during whatever overlay state it's in (tongued, riding,
burning, etc.). The handler then layers state-specific behaviour on top.

### 5.1 spr_state_init -- $03:9A6E

```
1. Set state byte = $10 (transition to alive)
2. id*3 -> sprite_inits indirect-pointer fetch
3. Tail-JMP to per-sprite Init handler via dp $00..$02
```

Has an alternate entry at `$03:9A6C` (`spr_state_init_entry`) that does
`PHK / PLB` first, used by callers that arrive with the wrong DBR.

### 5.2 spr_state_main -- $03:9A90

```
1. id*3 -> sprite_mains indirect-pointer fetch
2. Tail-JMP to per-sprite Main handler via dp $00..$02
```

Identical trampoline to `spr_state_init` but reads from `sprite_mains`.
This is the WORKHORSE -- it's the default per-frame call for any alive
sprite, AND it's called explicitly as `JSL spr_state_main` by every
other state handler so per-sprite Main keeps animating during overlay
states.

### 5.3 spr_state_tongued -- $03:9AC8 (state $08)

```
1. JSL spr_state_main (per-sprite Main)
2. AND $7040,x with $FFF3 (clear "draw normally" bits) -- sprite hides
3. Run swallow-progress code: mouth-bulge animation,
   watermelon-flavour detection (CMP against !Define_YI_NorSpr009/0EC/
   0ED/080/081/019/007/005 -- fire/lava/bubble/melon/iceberg melon types),
   sets !EXRAM_YI_Level_Player_AmmoTypeInMouthLo to one of 1..4,
   transitions slot to FlashingEgg/RedEgg/etc. on swallow.
```

### 5.4 spr_state_ride_yoshi -- $03:A11D (state $0A)

```
1. JSL spr_state_main
2. PHK/PLB
3. Zero X/Y speed (sprite moves with Yoshi, not under its own physics)
4. Read Yoshi's current animation frame ($60BE)
5. Index DATA_03F8E1 / DATA_03F6DE -- two parallel 256-entry tables
   of per-frame Y / X carry offsets
6. id*3 -> sprite_ridings indirect-pointer fetch
7. Tail-JMP to per-sprite RideYoshi handler
```

### 5.5 spr_state_die_collision -- $03:9F8D (state $0C)

```
1. JSL spr_state_main (one last per-sprite Main pass for despawn glints)
2. JSL despawn_sprite_stage_ID (free slot + stage record)
3. JML CODE_03B4D6 (death-pop OAM spawner in this bank)
```

Used when the engine itself decides the sprite is dead (e.g. environmental
collision, falling off-screen).

### 5.6 spr_state_on_head_bop -- $03:A085 (state $0E)

```
1. id*3 -> head_bops indirect-pointer fetch
2. Tail-JMP to per-sprite HeadBopped handler
```

Note: does **not** JSL spr_state_main first -- the per-sprite head-bop
routine is expected to call it explicitly if needed (most do via the
shared `head_bop_common` body at `$03:9F9F` which begins with JSL).

### 5.7 spr_state_turn_star -- $03:A247 (state $06)

```
1. JSL CODE_02808C (SuperFX dyntile uploader for the star tile)
2. JSL spr_state_main (last animation pass for the swallowed sprite)
3. Play SoundID $3B (sprite-pop SFX)
4. JSL despawn_sprite_stage_ID (release stage record)
5. Branch on $0B91,x (Yoshi-carry flag):
   - If set: spawn ambient score-pop sprite, play SoundID $09 (coin SFX)
   - If clear: spawn a new sprite slot via spawn_sprite_init.
                If original was NorSpr115 (coin), nudge YSpeed = $FD00.
```

### 5.8 spr_state_die_burning -- $03:A00B (state $12)

```
1. JSL spr_state_main (keep animating one more frame)
2. Force render-control words to draw the sprite as a flame:
   - $6FA0,x = $0060  (palette row 3)
   - $6FA2,x  AND #$FFE0  (clear low priority bits)
   - $7040,x  AND #$FFF3, ORA #$0004  (drawing method = $01)
   - $7042,x  AND #$00CF, ORA #$0020  (palette row 3 + bit settings)
   - If $7862,x flicker timer set, ORA #$0030 (extra flicker mask)
```

---

## 6. Despawn / spawn helpers (multi-entry)

After the state-dispatch table, Bank03 has a tightly-coupled set of
despawn / spawn helpers that EVERY per-sprite handler in the codebase
calls. Multi-entry routines with successively-narrower cleanup:

### despawn_sprite chain

| SNES addr | Alias | What it clears |
|---|---|---|
| `$03:A31E` | `despawn_sprite_stage_ID` | Stage-sprite record at `$70:28CA[stage_id]`, then falls into... |
| `$03:A32E` | `despawn_sprite_free_slot` | State byte = $00 (slot empty), then falls into... |
| `$03:A331` | `despawn_sprite_clear_graphics` | Dyntile slot ($7ECE/$7ECC) + player-platform pointer ($61B6). Doesn't touch state byte. |

Caller sites for `CODE_03A31E` + variants are extremely widespread (every
bank from 01 to 11 has dozens of `JSL.l CODE_03A31E` lines). Reading the
right entry point is the difference between "despawn fully" and "leave
the slot alive but graphics-cleared" -- pay attention to the four-byte
PC offset.

### spawn_sprite chain

| SNES addr | Alias | Result |
|---|---|---|
| `$03:A34C` | `spawn_sprite_init` | Search slot range `[$18..$5C]` from $5C down, write state $02 (run Init), fall through to body. |
| `$03:A34E` | `spawn_sprite_init_with_Y` | Same but caller supplies Y = starting slot. |
| `$03:A364` | `spawn_sprite_active` | Same as `spawn_sprite_init` but writes state $10 (skip Init -- caller has pre-populated everything). |
| `$03:A366` | `spawn_sprite_active_with_Y` | + caller-supplied Y. |
| `$03:A377` | `spawn_sprite` | Common body. Caller passes A=sprite_id, Y=slot. |
| `$03:A37A` | `spawn_sprite_active_state` | (continuation in shared body) |

Inputs / outputs convention:
- Input: A = sprite ID (16-bit, M=16)
- Output: Y = chosen slot; carry SET on success, CLEAR if no free slot

---

## 7. Caller inventory (cross-bank)

### Engine entry-point callers

`handle_sprites` / `handle_sprite` -- the per-frame driver. Called once
per frame from each game-mode dispatcher that needs sprite ticking:

| Bank | Callers | Use |
|---|---|---|
| Bank00 | 1 | Main per-frame game loop. |
| Bank01 | 1 | Gamemode `$0F` (Hookbill/Naval-Piranha boss closers; uses alt entry `$03:97DF`). |
| Bank10 | 1 | Camera-event ingress (uses alt entry). |
| Bank11 | 13 | Game-mode entry/exit paths, mini-game gamemodes, cutscene gamemodes. |

### Despawn / spawn caller density

Counted `JSL.l CODE_03A31E / 03A32E / 03A34C / 03A34E / 03A364 / 03A366 /
03A377 / 03A37A` across `yi/Banks/*.asm`:

| Bank | Calls | Bank | Calls |
|---|---|---|---|
| Bank01 | 11 | Bank0C | 39 |
| Bank02 | 41 | Bank0D | 35 |
| Bank03 | 56 (in-bank) | Bank0E | 26 |
| Bank04 | 23 | Bank0F | 24 |
| Bank05 | 31 | Bank10 | 3 |
| Bank06 | 21 | Bank11 | 33 |
| Bank07 | 54 | | |

So **roughly 400 JSL sites** across 12 banks invoke the engine's
despawn / spawn primitives. This is the most-used engine cluster in
the entire ROM (alongside `CODE_0085D2` push_sound_queue).

---

## 8. State byte writes across banks

To extend the engine (e.g. add a new state) you would need to find every
write to `!EXRAM_YI_Level_NorSpr_CurrentStatus`. By bank, the values
currently written are:

| Bank | States written | Notes |
|---|---|---|
| Bank01 | `$02`, `$06` | Boss-closer transitions write `$06` for "transform". |
| Bank02 | `$02`, `$06`, `$0E`, `$10` | Sprite-spawn and head-bop dispatch. |
| Bank03 | `$00`, `$02`, `$0C`, `$0E`, `$10` | The engine itself (init -> main -> die transitions). |
| Bank04 | `$02`, `$08`, `$0A`, `$0E`, `$10`, `$12` | Multi-state sprite families. |
| Bank05 | `$02`, `$08`, `$0C` | Boss/enemy state changes. |

Any new state value would also need a corresponding entry in
`sprite_state_routines` AND would shift the table indexing -- prefer
extending the EXISTING states (e.g. distinguish carriers by sprite ID
inside `spr_state_ride_yoshi`) over adding a new state.

---

## 9. Parallel implementation cross-reference

The same nine-state engine is implemented in `ys_enmy.asm`. The
correspondence between our state names and that file's per-state handlers
(verifying the same lifecycle and dispatch shape):

| Our name | Parallel handler |
|---|---|
| `spr_state_init` | Init handler (state $02 and $04 share the same target) |
| `spr_state_turn_star` | Turn-into-star handler |
| `spr_state_tongued` | On-tongue handler |
| `spr_state_ride_yoshi` | Ride-on-Yoshi handler |
| `spr_state_die_collision` | Despawn-by-collision handler |
| `spr_state_on_head_bop` | Head-bopped handler (sprite "fell" from a stomp) |
| `spr_state_main` | Move / per-frame Main handler |
| `spr_state_die_burning` | Burning-to-death handler |

The parallel implementation uses the same 9-entry word table with PHA/RTS
trampoline (`LDA <table>,Y / PHA / RTS`) and the same four per-sprite
3-byte pointer tables (init / main / head-bopped / ride-Yoshi) indexed by
sprite ID. Same structure, same lifecycle.

---

## 10. Cross-family engine idioms

Several patterns recur across the 23+ per-family deep-dive docs (`docs/family-*.md`).
None is a feature of the 9-state engine itself, but they're common enough that
recognising them is essential when reading any sprite-family code. This section
collects them; the family docs cite back here rather than re-explaining.

### 10.1 Slot-recycle morph

A sprite slot can transmute its OWN sprite-ID mid-frame, preserving EXRAM state
(position, velocity, timers) while the engine dispatcher sees a different sprite
ID the next frame and runs the new sprite's Main/Init from there. The pattern:

```asm
TXY                            ; preserve slot index in Y
LDA.w #$XXXX                   ; the new sprite ID
JSL.l CODE_spawn_sprite        ; spawn_sprite reuses slot Y when Y matches X
                               ; (it doesn't allocate a new slot; the byte
                               ; just rewrites the slot's SpriteID field)
LDX.b $12                      ; restore X
```

The morph is the *inverse* of the standard parent->child spawn (which allocates a
fresh slot via `CODE_spawn_sprite` from a free position). Same primitive,
opposite direction. Catalog of known users:

| Sprite | Morph | Trigger | Notes |
|---|---|---|---|
| `$019C` FlyingBumpty | -> `$0184` Bumpty | on Yoshi stomp | 1-frame `JML CODE_spawn_sprite`; only Bumpty variant doing this |
| `$0153` GoonieWithShyGuy | -> `$00E8` Goonie | after Shy-Guy passenger spawned | "self-retag" -- engine then sees a regular Goonie; unique among carrier sprites |
| `$0165` NipperSpore | -> `$0164` NipperPlant | on ground-collide | only family member using in-slot transmutation |
| `$0033` LittleMouserExitingNest | -> `$0030` LittleMouser | on status $08 | end of 8-substate exit choreography |
| `$01A3` LittleSkullMouser | -> `$0030` LittleMouser | on egg-hit | morphs to chowable variant |
| `$01A5` RunAwayMonkey | (variant) | on watermelon pickup | within the Grinder family |
| `$00AB` FullEggSpawner | (variant) | on spawn-fail fallback | rare: replacement target is a SMALLER payload |
| `$007B`/`$007C` BulletBills | -> `$007D` GreenBulletBill | on Yoshi-tongue contact | all three Bullet Bill flavors silently become Green when tongued -- the swallow animation is implemented for one variant only |
| `$0019D` SkeletonGoonie | -> `$019E` Wingless | on stomp | Goonie skeleton-tribe morph chain ($19D/$19E/$19F) |
| `$0019F` SkeletonGoonieCarryingBomb | -> `$019D` | if bomb taken/destroyed | morphs back to plain skeleton goonie |
| `$00A3`/`$00A4` HidingBandits | -> `$0020` Bandit | on emerge | within the Bandit-cover family |

The pattern works because the engine dispatcher reads `!EXRAM_YI_Level_NorSpr_SpriteID,x`
each frame to choose the Init/Main table indices. Rewriting the SpriteID byte is a
no-op on the *current* frame's handlers (already chosen), but takes effect at the
top of the next frame.

When you see `JSL CODE_spawn_sprite` followed by an `RTL` with the slot's CurrentStatus
unchanged, it's an in-slot morph. When the same call is followed by `STA` on a new
slot offset (typically allocated by the helper into Y), it's a parent->child spawn.

### 10.2 Variant-encoding taxonomy

When a single Init/Main body serves multiple sprite IDs (8+ families do this), the
"which variant am I?" question is answered by one of a small set of recurring
patterns. Catalog:

**Pattern A: position-derived** (the spawn-CELL parity selects the variant).
A bit of the sprite's *spawn position* decodes the variant -- and it is a **genuine
position bit, not a flag packed into the position for efficiency.** The 3-byte level
sprite record carries only a 9-bit ID + an 8-bit *whole-tile* X + a 7-bit *whole-tile*
Y (`docs/leveldataengine.md` §2); YI has no per-sprite "extra bits" property field
(unlike SMW). At spawn, `CODE_check_new_sprites` (Bank03.asm:2147-2158) expands those
tile cells to pixels with `ASL x4` (tile * 16) into `$70E2,x` (pixel X) / `$7182,x`
(pixel Y), with no sub-tile offset. Therefore pixel bits 0-3 are *always* 0 and
**bit-4 of the pixel position == bit-0 (LSB) of the tile coordinate** -- i.e. whether
the sprite was placed on an even or odd 16-px column (X) / row (Y). The designer
"picks a variant" by literally nudging the sprite one tile over; spawn-position parity
is YI's *only* per-instance variant knob, which is why so many Inits lean on it. The
read is `LDA $70E2,x : AND #$0010 : LSR` (x3 for a `dw` table, x4 for a `db` table)
`: TAY : LDA table,y`; the 2-axis form ORs X bit-4 with Y bit-4 into a 4-entry index.
(Inits read it *before* any centering `ADC #$0008`, and `+8` only touches bit-3, so
the raw placement parity survives. **Exception:** a parity read in a *Main* sees any
init-time re-centering, and a `SBC #$0008` borrows *through* bit-4 — `$064`'s
orbit-radius read (Bank04.asm:8426) runs after the shared init's Y−8, so its
resolved variant is the INVERSE of the placed-row parity: even row = wide orbit.
In-game verified 2026-06-11.)

**This is overwhelmingly a BEHAVIOUR switch, not the "cosmetic palette/mirror" earlier
drafts implied.** A ground-truth sweep found **~70 sprites** using the idiom (an early
draft listed only a handful, several wrong); only **~4 are palette**. What the parity
selects, grouped by frequency:

- **Initial movement direction** (XSpeed/YSpeed sign) -- the most common (~15):
  `$089`/`$08A` moving platforms, `$0EA`/`$0EB` cloud drops, `$12F`/`$130` lava drops,
  `$13E`, `$13F`/`$140`, `$152`, `$16E`/`$16F`, `$182`, `$183`, `$165`, `$104`,
  `$076`/`$077`, `$0E8` (X), `$0DF` PiscatoryPete (left/right).
- **Rotation direction (CW/CCW)** -- `$064`/`$15E` rotating cluster (X -> `DATA_04C242`
  `$80`/`$7F` -> sign of `$19,x` rotation increment, in the shared auto-init
  `CODE_04C2A7` Bank04.asm:8369; `$064` *additionally* reads Y -> orbit-radius variant
  `$04` -> `DATA_04C56C`/`04C666` in its Main, Bank04.asm:8426). Also `$1A0`/`$1A1`
  Firebar (`$78` += `DATA_0CA00B`), `$101`/`$102` SpikyMace, `$144` Flipper. The
  *manual* clusters `$0055`/`$0056` skip the auto-init and never read position -- they
  rotate from Yoshi's push. See `docs/family-platforms.md` §11.
- **Generator on/off** -- `$0E6` Gusty (Y), `$052` Balloon (X), `$0E7` Burt,
  `$105`/`$106` BooGuys+bomb, `$11B`/`$166` Lakitus (one-shot companion). Distinct from
  the *tile-driven* pipe-spawners `$01E`/`$133`/`$19A`, which read the DK pipe collision
  tag rather than position parity (see `docs/family-shyguys.md` §2.4, `docs/mchip.md`
  §3.3.2).
- **Spawned content** -- `$0B5` HiddenWingedCloud (X+Y -> which prize: 1-up / 5-stars /
  red-switch, `DATA_03C084`), `$1AB` BooBalloon (pop payload), `$1A7` Grinder (Bomb
  `$060` vs Needlenose `$0F9`).
- **Whole sub-mode / variant branch** (~17) -- `$045` PrinceFroggy (outside vs swallow
  fight), `$12B` FatGuy (small/big), `$048` cutscene Kamek (per-boss index), `$0E2`/
  `$0E3` BooBlah (floor/ceiling), `$0E8` Goonie (Y -> carries Shy Guy), `$032`/`$033`
  Mousers, `$157`/`$170` Lakitus, `$017` FrogPirate, `$19C` Bumpty, `$05F` AutoBoard
  (stall period), `$0AF`-`$0B4` MorphBubbles, `$0E0` PreyingMantas (3-step counter init).
- **Collision / reach** -- `$071` BigBoo (Y -> hitbox size), `$090` DanglingGhost
  (reach), `$146` PinkSluggy (activation range).
- **2-bit content index** -- `$0AD` MessageBox (X+Y -> one of 4 dialog slots).
- **Palette (the minority)** -- `$01E` ShyGuy (X+Y -> `DATA_shy_guy_palette_indices`,
  4 colours, `CODE_048A18`; also re-derived by the rider Shy Guys `$15E` spawns on its
  4 corners), `$0A5` NepEnut/GargantuaBlargg (X -> palette variant), `$0F2`
  ShyGuyOnStilts (X+Y -> 4 OAM palettes), `$181` CrazeeDayzee (X -> OAM palette attr).
- **Cosmetic / no-op** -- `$10D` PulleyGuy (X -> OAM h-flip only), `$0DB` SoftBlock
  (X -> a 2-entry table whose entries are identical: a dead variant).

**Classify by what the masked value DOES** (its branch / store), never by a label or
gloss -- this catalog was wrong several times by trusting names. Two earlier entries
were **removed as incorrect**: `$0125` Kamek ("x-low-nibble" -- impossible, since bits
0-3 are always 0 for a cell-aligned spawn) and `$0119` Spooky ("`$6150` phase" -- reads
no position bit at all).

**Pattern B: per-ID CMP-and-branch** (cheap when only 2-3 variants exist).
A sequence of `CMP.w #!Define_YI_NorSpr0XX_Variant / BNE.b ...` in the shared body.
- Bandit family `$020` / `$05B` / `$0A3` / `$0A4` etc.
- Cloud morph bubbles ($0B0-$0B4) at the pop-dispatch site.
- BooBlah `$0E2`/`$0E3` Piro-Dangle composite check.

**Pattern C: SpriteID arithmetic into shared table** (cleanest for 4+ variants).
`SpriteID - $base` produces an index used directly or after a small transform.
- `$0167-$016F` Koopa cluster: `SpriteID - $016B << 1` -> 2-entry color table
  (`DATA_07E1E0 = {$16A, $16C}`).
- `$0185-$018E` line-guided platforms: TWO-LEVEL split --
  `(SpriteID - $0185) AND $0002` picks color-pair (green/yellow),
  `AND $0001` picks visual-direction-flip-bit; 10 sprite IDs collapse to ONE Main.
- `$0117`/`$0118` Donut Lift: `CMP #$117 / BEQ` picks collision-box width $08 vs $10.
- `$0137`-`$013A` Falling Stones: 4-entry `DATA_029E4D` of `(X-width, Y-width)` pairs.
- `$015C`/`$015D` switch + `$015F`/`$0160` platforms: `(SpriteID - $base) ASL`
  -> pair-index $00 vs $02 -> indexes FOUR parallel global arrays
  (`$0FC1+y / $0FCD+y / $0FD1+y / $0FD5+y`).
- `$0078`/`$0079`/`$007A` Bullet Bill Blasters: `SpriteID - $0078 << 1`
  -> 3-entry table.
- `$0068`/`$0069`/`$006A` Egg Blocks: `SpriteID - $0068 << 1` -> 3-entry hop-velocity
  + cooldown tables.
- `$01A5`-`$01A9` Grinder/Monkey: `$701900,x`-byte indexing with a -$02 table offset.
  A 6th entry ($0C) is the shared death-pose handler -- killing ANY Grinder rewrites
  its variant byte to $0C, letting all variants share one dying animation while
  preserving variant identity during alive states.
- `$011E`/`$011F` Arrow Wheel: `SpriteID - $11E` -> 2-entry angular-step table
  (cleanest single-byte-determines-speed example).

**Pattern D: fall-through Init** (densest collapsing; family-eggs.md is the
benchmark with 7 IDs collapsing into 3 physical bodies).
A chain of Init labels with no `RTL` between them: each label is a different
sprite's entry point, but the code naturally flows from earlier-Init to later-Init.
The "later" sprites get the prologue, the "earlier" sprites do extra work and fall
through.
- Egg family `$022`/`$023`/`$024`/`$025`/`$029`/`$02A`/`$02B` (Bank03:7551-7559):
  $022 FlashingEgg falls through into $023/$024 generator-guard, which falls
  through into $025/$029/$02A/$02B's RTL.
- Watermelon `$005`/`$007`/`$009` (Bank04:72-75): all three at one Init label.
- Cannonball `$00B` / Bomb `$060` (Bank0E:44-46): two distinct sprites at one
  Init body.
- Needlenose `$099`/`$0A2`/`$0E5`/`$0F9`/`$11D` (Bank0E:6394-6400): 5 sprites at
  one RTL-only Init.

**Pattern E: latent flag sentinel** (single-spawn-site provenance).
When a sprite has exactly one runtime spawner, the spawner stamps a sentinel byte
that the sprite's Main reads to distinguish "I was spawned by X" from "I was placed
by level data". Lets one sprite-ID double-duty:
- `$0029` GiantEgg vs giant-egg projectile: same sprite-ID; `$7AF8,x` swallow
  timer being armed distinguishes the swallow-respawn role from the thrown
  projectile.
- `$000B` Cannonball: `$7D38 = 1` sentinel set by Kaboomba (only spawner).
  Cannonball's Main is a 2-line wedge checking this sentinel before falling
  into Bomb's shared Main.

### 10.3 Cross-family code-sharing surprises

Some sprites reach across the family boundary to reuse code from an unrelated
family. Rare but real:

- **`$0074` Spike / `$0075` SpikeBall reach into Shy Guy state handlers.**
  `DATA_spike_state_ptr[$03]` points at `CODE_shy_guy_state_02_stunned`;
  `DATA_spike_ball_state_ptr[$04]` points at `CODE_shy_guy_state_05_stub`.
  A Spike's stomp-recovery is literally the same code path as a shy-guy's.
- **`$0095`/`$0096` Checkered Block re-inits itself as `$0089`/`$008A` moving
  platform.** Bank05's Checkered Block calls `CODE_init_red_platform`/
  `CODE_init_pink_platform` from Bank04 during its toggle state -- one of the
  rare cross-bank cross-sprite reuse patterns.
- **`$00DE` FallingRockPlatform shares Main with `$0137`-`$013A` Falling Stones
  byte-identical.** Only Init differs ($0DE probes the floor via SuperFX,
  $137-$13A look up per-variant hitbox in a 4-entry table); Main is byte-identical.
- **`$0029` GiantEgg shares the egg-physics body** with the smaller eggs.
  The "swallow respawn" behavior is layered as a top-of-Main wedge ahead of the
  shared physics body.
- **Boss music kicked by `$0048` CutsceneKamek**, not by the boss itself.
  See `docs/bossengine.md` §1 item 7 for the full architecture.

### 10.4 Where to start reading a new sprite-family

When opening a fresh `docs/family-*.md` and needing to understand the per-sprite
code:

1. Find the Init handler in `yi/Banks/Bank<XX>.asm`. Check whether multiple Init
   labels are stacked (fall-through Pattern D) -- if so, the *last* label is the
   shared body, the *earlier* labels are pre-prologues.
2. Find the Main handler. Check whether it dispatches on `$76,x` (combat state)
   or `$16,x` (sub-state) or both. Most non-boss sprites use `$76,x`.
3. Read the state pointer table at the top of the Main body. Each entry is a 2-byte
   `dw` of a `CODE_xxxxxx` label. Count the entries.
4. Check whether the Main reads `$701900,x` or `$701902,x` (generic per-slot scratch
   bytes that the Init may have stashed variant info into). If yes, the Init is
   doing variant encoding (Pattern A/B/C/E above).
5. Check the head-bop handler -- if it's `head_bop_common` it's the shared
   "stomp + keep animating" path; if it's a custom label the sprite opts out of
   Main during stomp (see §5.6).

---

## 11. Open questions

1. **State `$04` vs `$02`** — **RESOLVED 2026-05-25.** State $04 is **never written by the YI engine.** A grep of all 36 banks + Routines/ for `STA NorSpr_CurrentStatus` (159 sites total) tallies the immediately-preceding `LDA.w` immediate values: `#$0002` 51x, `#$0010` 49x, `#$000E` 32x, `#$000A` 7x, etc. `#$0004` appears **zero** times before a state-byte STA. The three `LDA.w #$0004` in the codebase (`Bank04.asm:4582`, `Bank05.asm:14717`, `Bank0F.asm:7631`) all store $0004 to **timer/scratch addresses** (`$7A98,x`, `$76`, etc.); in each case a different LDA loads the actual state ($10 or $1C) before the STA. The state $04 slot in `sprite_state_routines` aliases to the same `spr_state_init` target as $02 (`Bank03.asm:2713-2714`) — a structural alias preserved for defensive dispatch (so a corrupted state byte landing on $04 still works), but the engine never writes it. `CODE_spawn_sprite_init` writes `#$0002`; level-data sprite-stream spawner in Bank10/11 also writes $02. The "$02 = level-list, $04 = programmatic" hypothesis is wrong — both routes write $02.

2. **`spr_state_on_head_bop` does NOT call `spr_state_main` first** — **RESOLVED 2026-05-25.** Hypothesis confirmed and sharpened: per-sprite head-bop handlers **deliberately opt out of Main**. The trampoline at `Bank03.asm:4429-4443` is the only state handler in the 9-entry dispatch that doesn't open with `JSL CODE_spr_state_main` — all six other state handlers (`init`, `main`, `tongued`, `die_collision`, `die_burning`, `ride_yoshi`, `turn_star`) do. The shared body `CODE_head_bop_common` at `$03:9F9F` opts back in by calling Main as its first instruction; 28 ordinary sprites alias directly to it (`_StompRt:` labels at lines 4274-4302) and one sprite (FlashingEgg $022) does a small prologue then falls through. **Custom head-bop handlers universally bypass Main**: a grep for `JSL.l CODE_spr_state_main` across Bank04/05/06/07/0C/0E/0F returns **zero hits**. Bank01/Bank02 (bosses) have no `_StompRt` labels at all — bosses can't be stomp-bopped. The design intent is: shared `head_bop_common` is the easy "stomp + keep animating" path, custom handlers want fully-frozen sprite during the stomp animation.

3. **State `$0A` (ride_yoshi) trigger inventory** — **RESOLVED 2026-05-25.** 7 transition sites across 3 banks write `#$000A` to `NorSpr_CurrentStatus`:
   - **Bank04** `main_shy_guy` (`:1874`), `grim_leecher_state_01_hop_at_yoshi` (`:4271`), `CODE_04DC2E` Baby Mario respawn (`:11715`)
   - **Bank06** `main_baby_mario` (`:7718, :7894, :8886`) — two preceded by `SoundID43_MountYoshi`
   - **Bank0D** `main_baby_bowser` (`:9166`) — Baby Bowser fight intro cinema, also stashes `$7E48 = X`

   `DATA_sprite_ridings` (Bank03:1427) has 442 entries; 438 point to the shared RTL stub at `$03:9A6B`. Only **4 sprites have meaningful custom `_RideYoshiRt`**:
   - `NorSpr061_BabyMario` → `riding_baby_mario` (Bank06:8942, ~340 lines, the bobbing + Mario-loss bubble path)
   - `NorSpr12A_ShyGuyBanditTrap` → `ride_bandit_shyguy` (Bank04:2315, forced-exit cinema trigger)
   - `NorSpr037_GrimLeecher` → `ride_grim_leecher` (Bank04:4487, 2-state drain/struggle dispatch)
   - `NorSpr134_BabyBowser` → `ride_yoshi_baby_bowser` (Bank0D:11466, fight-intro cinema)

   The hypothesis that the tongue chain in Bank04 is the trigger was partly right — shy-guy pickup IS in Bank04 — but state $0A is reused for non-tongue paths too (Baby Mario respawn, Baby Bowser mount-cinema). Per-sprite handlers add tick logic on top of the engine's universal carry-offset positioning (state-$0A dispatcher at `$03:A11D` reads `DATA_03F8E1`/`DATA_03F6DE` indexed by `$60BE`, see Q5).

4. **Per-slot sprite timer semantics** — **RESOLVED 2026-05-25.** The five timers are a **generic countdown pool**, not statically-assigned behaviours. Each sprite picks whichever timer(s) it needs:

   | Timer | Role | Pause-gated? |
   |---|---|---|
   | `$7A96,x` | Generic timer #1 — most-used. Animation pace, sub-state cooldown, debounce. | Yes |
   | `$7A98,x` | Generic timer #2 — secondary cooldown / posture hold / paired companion to $7A96. | Yes |
   | `$7AF6,x` | Generic timer #3 — usually a longer state/recovery cooldown or i-frame counter. | Yes |
   | `$7AF8,x` | Generic timer #4 — companion to $7AF6 (swing/anim cycle, second cooldown). | Yes |
   | `$77C1,x` | **No-pause timer** — only timer that ticks while global freeze/mosaic/item-use is active. Used for the swallow/tongued countdown and some cinematic counters. Never written directly as a byte — set via word-stores to `$77C0`. | No |

   The four freeze-gated timers (`$7A96/$7A98/$7AF6/$7AF8`) are decremented together inside the `BNE CODE_039A49` skip block (`Bank03.asm:2643-2657`), so they all pause together. `$77C1` is decremented in `CODE_039A49:` AFTER the freeze branch (`Bank03.asm:2658-2661`), keeping it always-ticking. The Raidenthequick reference disassembly already names these `!s_spr_timer_1..4` and `!s_spr_timer_nopause`, confirming the engine intent. Usage patterns: minor enemies use just $7A96; ChainChomp/Bubble pair $7A96+$7A98; bosses (Hookbill) spread across all four for distinct sub-states (head-back, spit, dive i-frames, run).

5. **Carry-offset tables `DATA_03F6DE` (X) and `DATA_03F8E1` (Y)** — **RESOLVED 2026-05-25.** Both are **256-byte tables of signed bytes** (`db` directives), indexed by `$60BE` (`!EXRAM_YI_Player_CurrentAnimFrameLo`, Yoshi's current animation frame). Confirmed by counting: each is 16 rows × 16 bytes = $100, and the next table `DATA_03FAE5` starts exactly $200 later.

   The consumer `CODE_spr_state_ride_yoshi` (`Bank03.asm:4521`) fetches sign-extended bytes via a one-instruction load+extend idiom: `LDA table,y / AND #$FF00 / BPL... ORA #$00FF / XBA`. Net effect: carried-sprite world position = Yoshi's position + signed per-frame offset from the table. X is negated when `$60C4` (facing) is left-facing. The X-byte's bit `$40` is repurposed as a **draw-priority flag** stored at `$74A2,x` (masked off with `#$BF00`) — that's why X values like `$46` / `$42` show up: the carried sprite swaps draw priority on those frames.

   Sample interpretation of Y-offsets: rows 0-1 are mostly `$04..$06` (carried object hangs +4..+6 px below Yoshi's saddle during idle/walk). Block $20-$2F is the duck cycle (`$F8..$02` — object lifts -8..+2 when Yoshi crouches). Block $F0-$FF is the jump/flutter cycle (`$FB..$08`). Sample X-offsets: long flat run at `$06` (back-of-saddle); `$BC` at $1A-$1F (object swings ahead during head-turn frames).
