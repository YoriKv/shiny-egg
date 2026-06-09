# YI Goonie family reference

Standalone reference for the Yoshi's Island Goonie sprite family --
the black/skeletal flying bird that appears almost exclusively in
beach, cave-of-bats, and Hookbill-castle stages. The base $0E8 Goonie
swoops on Yoshi from a side spawner; the family fans out into a
wingless flock-walker ($0E9), two payload carriers (Shy Guy $153,
Bowling Ball $158), a fat eatable variant ($155), and three
World-3 castle "skeleton" reskins ($19D / $19E / $19F).

This doc complements:

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  every entry here layers its own sub-state machine on top of.
- `docs/family-shyguys.md` -- the Goonie-with-Shy-Guy ($153) is shared
  between this doc and that one; the Shy Guy payload mechanics live
  there, the Goonie's flight + spawn / re-tag logic lives here.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank0E.asm` (the regular + fat + bowling + shy-guy
carriers) and `yi/Banks/Bank0C.asm` (the three skeleton variants),
with sprite-table wiring + StompRt/RideYoshiRt stubs in
`yi/Banks/Bank03.asm`. Cross-verified against
`yoshisisland-disassembly/disassembly/bank0E.asm` and
`bank0C.asm` (Raidenthequick's descriptive labels: `init_goonie`,
`init_flightless_goonie`, `init_fat_goonie`, `init_bowling_goonie`,
`main_goonie`, `main_fat_goonie`, `init_skeleton_goonie`,
`main_skeleton_goonie`, `head_bop_skeleton_goonie`,
`init_skeleton_goonie_flightless`, `init_skeleton_goonie_with_bomb`,
`main_skeleton_goonie_with_bomb`, `head_bop_skeleton_goonie_bomb`)
and the parallel sources `ys_enmy*.asm`.

---

## 1. Family at a glance

Eight sprites belong to the Goonie family. The base $0E8 is the only
"true" flyer in the regular tribe; $0E9 is a ground-bound flock of 3;
$153 / $155 / $158 share init / main with $0E8 via fall-through label
chaining. The three Bank0C skeleton variants share their own micro-
state machines.

| Sprite ID | Constant name                       | Bank | Init handler                             | Main handler                                  | StompRt          | Role |
|-----------|-------------------------------------|------|------------------------------------------|-----------------------------------------------|------------------|------|
| `$0E8`    | `Goonie`                            | 0E   | `$0E:9442` `init_goonie`                 | `$0E:951E` `main_goonie`                      | shared stub      | Single flying Goonie. 7-state ptr table. Reserves the flock-counter slot $0C7C; respawns from edge while counter is non-zero. |
| `$0E9`    | `3WinglessGoonies`                  | 0E   | `$0E:936E` `init_flightless_goonie`      | `$0E:951E` shared `main_goonie`               | shared stub      | Spawner + flock-parent for 3 ground-walking Goonies. Spawns 2 child $0E9 instances with staggered X-offsets ($10, $20) and shared facing. |
| `$153`    | `GoonieWithShyGuy`                  | 0E   | `$0E:942D` `CODE_init_goonie_with_shyguy`| `$0E:951E` shared `main_goonie`               | shared stub      | Goonie carrying a Shy Guy on its back. Init shared with $0E8 (entered via BEQ). On launch spawns a $01E Shy Guy passenger via `CODE_03A366`, linked through `$78,x`; re-tags self to $0E8 sprite-ID. |
| `$155`    | `FatGoonie`                         | 0E   | `$0E:9A9B` `init_fat_goonie`             | `$0E:9B38` `main_fat_goonie`                  | shared stub      | Oversized Goonie. 11-state ptr table (perch / drop-shy-guy / fly / dive). Init validates spawn distance (off-screen rejection at >$0120 dx). |
| `$158`    | `BowlingGoonie`                     | 0E   | `$0E:9AB5` `init_bowling_goonie`         | `$0E:9B38` shared `main_fat_goonie`           | shared stub      | Goonie carrying a Bowling Ball (a chained / dragged hazard). Shares init body with $155 but enters at the "$158" entry that sets initial state $76=$0A. Shares 11-state main. |
| `$19D`    | `SkeletonGoonie`                    | 0C   | `$0C:9B6C` `init_skeleton_goonie`        | `$0C:9B8A` `main_skeleton_goonie`             | own `head_bop_skeleton_goonie` ($0C:9C48) | Winged skeleton glider. Constant X-speed from $7400-facing; Y-jitter from 9-entry sine table `DATA_0C9BBC`. Spawns $215 wing-flap ambient on $7A98 timer. On stomp morphs to $19E + drops $216 feather + plays `SoundID07_GoonieLoseWings`. |
| `$19E`    | `WinglessSkeletonGoonie`            | 0C   | `$0C:9CF3` `init_skeleton_goonie_flightless` | `$0C:9CFD` `main_skeleton_goonie_flightless` | shared stub      | After-stomp ground form. 3-state main (walk / fall / despawn-animate). |
| `$19F`    | `SkeletonGoonieCarryingBomb`        | 0C   | `$0C:9D6C` `init_skeleton_goonie_with_bomb` | `$0C:9DF4` `main_skeleton_goonie_with_bomb`  | own `head_bop_skeleton_goonie_bomb` ($0C:9FDE) | Skeleton Goonie with a $060 Bomb. Init spawns the bomb linked via `$7A36`; if bomb is taken/destroyed, morphs into plain $19D. Stomp drops bomb + spawns $19E wingless variant. |

### 1.1 Subfamily layout

Three logical subgroups share little code across the boundary:

- **Regular tribe** ($0E8 / $0E9 / $153 / $155 / $158, all Bank0E).
  Bound by *shared init label chaining* + a *shared `main_goonie`
  state-ptr table*. Inside `main_goonie` the 7-entry state table
  drives perch / launch / fly / dive / get-eaten / approach / shyguy-
  drop. The fat variants ($155 / $158) get their own 11-entry table
  in `main_fat_goonie` because the fat sprite is *both* a hazard
  and a Yoshi-edible (it carries a Shy Guy that drops on landing).
- **Skeleton tribe** ($19D / $19E / $19F, all Bank0C). Castle-only
  recolors. Each variant has its own init + main + StompRt; the only
  shared mechanism is the 9-entry sine table `DATA_0C9BBC` for Y
  jitter, the wing-flap ambient spawner pattern, and the
  cross-variant morphing via in-place `CODE_spawn_sprite`.
- **Note on $0E9 vs Raidenthequick label**. The label says
  `init_flightless_goonie`, but read literally: $0E9 is a
  *flock-parent* that *also* serves as the per-child sprite (it
  re-spawns itself with `CODE_spawn_sprite_active`). The first
  instance increments $18,x and recursively spawns 2 more; child
  instances skip the spawn block because their
  `EXRAM_YI_Level_NorSpr_GenericTable701900` slot is already inc'd
  from the parent.

---

## 2. The shared `main_goonie` state machine ($0E8 / $0E9 / $153)

`main_goonie` at `$0E:951E` dispatches through the 7-entry table
`DATA_goonie_state_ptrs` at `$0E:9510`:

| `$76,x` | Handler      | Role |
|---------|--------------|------|
| `$00`   | `CODE_0E98A9` | **Perch / pre-launch.** Wing-flap idle: cycles `$7402,x` through frames 0..8 on a 4-frame cooldown ($7A98). On rollover, picks a new $7400 facing-X-offset from a tiny 2-entry table (DATA_0E98A5 = -$0100/+$0100) and advances $76 to state $01. Uses $7C16 (offscreen-X) gating. |
| `$02`   | `CODE_0E98EF` | **Launch / climb.** Pumps $7402 from $00..$0C with $75E2 = $0100 (lift Y). On $7402 == $09 with the $16,x random-seed exhausted, hands off to state $02 with X-speed locked in. |
| `$04`   | `CODE_0E9939` | **Cruise / horizontal flight.** Sets a 6-frame cooldown (random +0/+1) and zeroes the anim frame; cleared by `CODE_0E983D` once the cruise window ends, transitioning back to state $00. |
| `$06`   | `CODE_0E995F` | **Dive-aim.** Animates $7402 through 0..$08 every 1 frame; $75E2 ramps Y-velocity downward by 1 per tick, floored at -$0020. Sub-hitbox $7542 set to $40 (large) when Yoshi is above ($7223). |
| `$08`   | `CODE_0E999B` | **Get-eaten / on-tongue.** Picks one of two horizontal velocities from `DATA_0E9997` (-$0200/+$0200) based on $7400, flips $6FA2 to $0841 (highest priority sprite block), and animates $7402 between $0C..$0F. The dispatcher's tail-call branches to `JSL CODE_0DC0F0` (`$0D:C0F0`) -- the tongue-eat hook -- when state is $04 and $7AF8 is 0. |
| `$0A`   | `CODE_0E99D0` | **Yoshi-approach trigger.** When $7680 (offscreen-X delta) plus $0020 falls inside the screen and the sign of $7680 vs $70E2 indicates approach, sets `$74A2 = 5` (forces gfx-priority dim), arms $7400 facing from `$77C2,x` (Yoshi-facing reference), and switches to state $01. If sprite-ID is $153 (Goonie-with-Shy-Guy), calls the inline `CODE_0E94C4` which spawns the Shy Guy passenger *here*, not in init. |
| `$0C`   | `CODE_0E9A2F` | **Shy Guy drop / landing.** Used only by $153. Reads the linked Shy Guy slot from `$78,x`; if the Shy Guy is still alive, statused, and tagged `7019D6 = 3` ("riding the goonie"), checks the player-relative X/Y. When the goonie is overhead and falling, it zeros Shy Guy Y-velocity and synchronizes the Shy Guy's X-speed with the goonie's, letting the Shy Guy land. Updates own anim frame in $7402 (cycles $0F..$11 every 5 frames). |

The handler is invoked as `JSR.w (DATA_goonie_state_ptrs,x)` after
the standard `ASL : TAX` index conversion. `main_goonie` wraps the
dispatch with three pre/post stages:

1. **Pre-dispatch tick** (always): `CODE_03AF23` for standard
   physics + animation, `CODE_0E971F` to manage the priority-bit
   patching and floor-snap if state != $05.
2. **Stomp-or-eat fork**: if `CODE_0E95AE` detects the slot's
   `CurrentStatus` is $08 (stomped), the function bails into the
   stomp-cleanup branch which clears X/Y speed, spawns the death-pop
   $1FF ambient, sets $7AF6 = $40 (drift cooldown), and forces
   `$76 = $04` (return to cruise after re-display). If status is $10
   (alive) it continues into the per-state handler.
3. **Post-dispatch SuperFX intersection test** (states != $04, $05):
   `CODE_0E9638` runs `FXCODE_099011` (geometry intersection against
   carried-payload candidate slots). If the test returns a held egg
   in range, the goonie tries to "catch" it via `CODE_03B25B` (forced
   detach) -- this is the "egg-grab while diving" mechanism that
   lets a Goonie steal a mid-flight egg, though in practice the
   filter at lines 2940-2944 limits the catch to non-flashing eggs.

### 2.1 Per-slot state held by a Goonie

Beyond the state byte at `$76,x`, the Goonie machine uses these
slot fields (all accessed via X):

| Address                       | Meaning |
|-------------------------------|---------|
| `$76,x`                       | Current sub-state (0..$0C). |
| `$78,x`                       | $153 only: slot-index of the linked Shy Guy passenger. |
| `$18,x`                       | Spawn-stagger counter for $0E9 flock (1 = parent done spawning, 2 in spawn-loop) -- and "init done" gate for $0E8. |
| `$16,x`                       | Random anim seed (3..7); decrements per cycle, drives randomized wing-flap pacing. |
| `$7400,x`                     | Facing direction (0 = right, 2 = left). Indexes the 2-entry velocity tables DATA_0E98A5 / DATA_0E9364 / DATA_0E9997 / DATA_0E9A97. |
| `$7402,x`                     | Anim frame (passed straight to OAM builder). Values 0..$1F are valid; certain ranges encode "wing-out", "wing-in", "diving", "with payload". |
| `$7A36,x`                     | Cross-screen reach pulse -- the initial X-distance budget for state-$00's spawn cycle (set to one of $FFE0/$0130 from DATA_0E936A); decremented as the goonie cruises. |
| `$7A38,x`                     | Off-screen despawn timer + spawn-cycle gate. Non-zero = "I'm in the spawn loop" branch in main. |
| `$7A96,x`                     | Generic per-slot countdown #1 (spawn cooldown, etc.). |
| `$7A98,x`                     | Generic per-slot countdown #2 (anim pace + state expiry). |
| `$7AF6,x`                     | Drift-on-stomp cooldown -- set to $40 by stomp branch. |
| `$7AF8,x`                     | Tongue-eat gate; cleared by `CODE_0DC0F0` when Yoshi licks. |
| `$74A2,x`                     | Gfx priority byte. $FF = highest priority (visible above terrain). |
| `$75E2,x`                     | Sub-Y-velocity (sub-pixels per frame). Drives lift/dive smoothness. |
| `$7542,x`                     | Hitbox Y-half-size. $40 = large (cruise), $20 = small (stomp). |
| `$6FA0,x`, `$6FA2,x`          | OAM tile/palette base pair (gfx pattern for the current frame). |
| `$0C7C` (global)              | **Flock spawn counter** -- shared by all $0E8 instances. Init sets to 1; cruise sub-state in `CODE_0E9561` won't decrement until the goonie is despawning; spawn block (`CODE_0E957A`) requires this be non-zero to spawn a fresh $0E8 from the same edge. |
| `$701900,x` (EXRAM)           | Init-gate sentinel. Set to $FFFF after first init so re-spawn cycles can detect first-vs-subsequent runs. |
| `$701902,x` (EXRAM)           | Spawn-Y anchor for the next respawn from-edge cycle. Mirrored to the freshly spawned slot's $7182. |

### 2.2 Spawn-from-edge / flock-respawn (the $0E8 cycle)

A novel piece of the Goonie code: $0E8 is **respawning**. Unlike a
typical level-data sprite that spawns once and despawns, the
single Goonie at `CODE_0E9561` polls a global counter and respawns
fresh slots from the edge of the screen for as long as the flock
is "active". The cycle:

1. **First instance** runs `init_goonie` ($0E:9442). Sets up the
   sentinel $701900 = $FFFF, picks initial Y from $7182's bit-4 to
   index DATA_0E936A (= $FFE0 or $0130), arms $7A98 = 3 (initial
   anim window), and stores Y-velocity 0 / X-velocity = facing.
   Increments the global counter $0C7C if it was 0.
2. **Each subsequent frame**: `main_goonie`'s top branch checks
   $7A38. When non-zero (despawn-pending) the slot is no longer
   running the per-state handler; instead it runs `CODE_0E9561`
   which tries to spawn a fresh $0E8 via `CODE_spawn_sprite_init`
   from a screen-edge X-coord (computed off `$6094 & $FFEF +
   $7A36`). On success: copies parent's $701902 (Y-anchor) into
   the child's $7182, flips $7400 facing via EOR #$0002, and resets
   $7A96 = $0100 (1-frame cooldown for the next spawn attempt).
3. **Edge despawn** (`CODE_0E9576`): if the goonie has left the
   visible window ($7682 + $40 >= $0160) *and* $0C7C is zero (no
   active flock parent), free the slot via `CODE_03A31E`.

This is the only sprite in YI (alongside the Toady spawn-spammer)
that runs a continuous level-edge spawner from within its own main.
Most flock effects are driven from the level-data sprite list.

### 2.3 Get-eaten path

When Yoshi tongues a Goonie:

- The engine sets the slot's `CurrentStatus` to $08 (tongue-touched
  edge case for "edible enemy").
- `CODE_03A5B7` from inside the slot link probe acknowledges the
  catch and sets the goonie's $76 to $05 (state value, dispatched
  by the table-indexer as the $05/$08 entry's pair via `LDY $76;
  CPY #$05` early-out in `main_goonie`).
- State $05 (handler `CODE_0E999B`) zeroes X/Y speed except for a
  side-flick, then waits for $7AF8 to expire. On expiry,
  `JSL CODE_0DC0F0` (`$0D:C0F0`) is invoked: this is the tongue-
  eat hook; it returns the goonie's slot to Yoshi as an egg
  (via `CODE_03B25B` to detach + transmute) when the
  egg-spawn rules permit (line 8328 -> `CODE_04906C`).

The result: a tongued Goonie becomes a normal egg. This is the
expected behaviour for "edible flyers" in YI (alongside Flopsy
Fish, Spear Guys, etc.).

---

## 3. The shared `main_fat_goonie` state machine ($155 / $158)

`main_fat_goonie` at `$0E:9B38` is the fat-variant dispatcher. It
shares some pre-dispatch with `main_goonie` (`CODE_0E95AE` for the
stomp branch, `JSL CODE_03AF23` for physics) but has its own
SuperFX-render front-end (`CODE_0E9CED` / `CODE_0E9DC0`) and its own
11-entry state-ptr table `DATA_fat_goonie_state_ptrs` at `$0E:9B1E`.

| `$76,x` | Handler        | Role |
|---------|----------------|------|
| `$00`   | `CODE_0E9FA6`  | **Idle / floor probe.** Reads the floor-touch bits `$7860 & $0F`; if any are set, picks a follow-up state from `DATA_0E9F9C` (5-entry table indexed by `DATA_0E9F8F` lookup) and seeds the per-state spin index in $79. Otherwise drops Y-velocity and falls into the "low velocity ramp" branch. |
| `$02`   | `CODE_0E9FFE`  | **Descent ramp.** Decreases $7A36 (the SuperFX scale factor) by 4 per frame, floored at $00D0 -- when it reaches the floor, marks `701900 = $0008` and advances $76. The scale factor drives the perspective-scale rendering of the fat sprite. |
| `$04`   | `CODE_0EA01A`  | **Ascent ramp + Shy-Guy drop.** Adds $701900 to $7A36 each frame, capped at $0140. On reaching $0100, plays `SoundID03_Swim` and (if state was $02) shifts Y-velocity to $FC00 (upward kick). Tail-jumps to `CODE_0EA11D` (the spin-anim timer increment). |
| `$06`   | `CODE_0EA06E`  | **Reset to descent.** Drops $7A36 by 8/frame, floored at $0100 then resets $76 to 0. Tail-jumps to `CODE_0EA11D`. |
| `$08`   | `CODE_0EA086`  | **Ascend before flap.** $7A36 += $0008/frame, capped at $0140; on cap, advances $76. |
| `$0A`   | `CODE_0EA09C`  | **Bowling-Ball entry / pre-flight.** Used by $158 as initial state. Pre-decrements $7A36 by 4/frame; when X-velocity hits zero, *flips $7400 facing* via EOR #$0002, re-sets X-velocity from `DATA_0E9A97`, sets $7542 = $20 (small hitbox), plays `SoundID03_Swim`, advances $76. |
| `$0C`   | `CODE_0EA0DD`  | **Climb after launch.** $7A36 += $0004/frame, capped at $0100; on cap, resets $76 to 0 (full perch cycle). |
| `$0E`   | `CODE_0EA0F7`  | **Sway anim.** Bobs $7A38 by ±$0004 (from `DATA_0EA0F3`) per frame, masked to $01FE. On floor-touch bits 2-3, flips $19,x (the sway direction) and pulls $7400 from $701902 (cached facing). This is the slow-side-to-side hover of an idle fat Goonie. |

Note the **entries 4-6 alias entries 1-3** in the state-ptr table:
both pairs ($02/$08, $04/$0A, $06/$0C) point to the same handler
addresses, but the *initial state-byte $76 value* differs. $155
enters at state $01 (idle), $158 enters at state $0A (carry-and-
launch). This is how the same code body serves both "perch +
launch" ($155) and "bowling drop" ($158).

### 3.1 Per-slot state held by a Fat Goonie

| Address                       | Meaning |
|-------------------------------|---------|
| `$76,x`                       | Current sub-state (0..$0E). |
| `$78,x`                       | Per-state seed (0..$09); selected from `DATA_0E9F8F` on floor-touch; used in `CODE_0E9F2D` to pick the side of the SuperFX render. |
| `$79,x`                       | Spin index. Incremented by `CODE_0EA11D` once per anim-tick, modulo 9. Drives the per-frame OAM expansion through the `DATA_0E9B91` 10-entry "fat goonie sprite frame" pointer table. |
| `$19,x`                       | Sway-direction toggle ($00 or $02). Flips on each floor-touch. |
| `$7400,x`                     | Facing direction (0/2). |
| `$7402,x`                     | Anim frame; doubles as the "currently-running SuperFX expansion" indicator (state $00 = scale-rendering, anything else = simple sprite). |
| `$7A36,x`                     | **Scale factor** for SuperFX-rendered fat sprite. Range $00D0..$0200. Smaller = closer to viewer (zoomed). |
| `$7A38,x`                     | Sway state (0/2-bit + accumulated 9-bit phase). Sub-anim driver for state $0E. |
| `$7A96,x`, `$7A98,x`          | Generic countdowns (state expiry, anim pace). |
| `$7542,x`, `$75E2,x`          | Hitbox + sub-Y-velocity (same as base goonie). |
| `$701900,x` (EXRAM)           | Init-gate sentinel + per-state delta (e.g. set to $0008 by state $02 -> consumed by state $04). |
| `$701902,x` (EXRAM)           | Cached facing direction (used by state $0E to restore $7400 after a sway flip). |
| `$7BB6,x`, `$7BB8,x`          | Camera-relative X/Y offsets (for the SuperFX intersection-test path in `CODE_0E9E86`). |

### 3.2 Fat Goonie SuperFX render

`CODE_0E9CED` (the renderer) is the visually-distinctive part:
it scales the fat-Goonie sprite via SuperFX so the bird grows
as it descends and shrinks as it ascends. The pipeline:

1. `CODE_0E9CFB` sets up R1/R2 (PLOT X/Y), stuffs $7A36 into R6
   (multiplier). If the scale is < $0100, reflects via XOR-and-inc
   so the SuperFX sees an in-range factor.
2. Calls `FXCODE_0B86B6` (SuperFX multiplier ramp) to compute the
   per-pixel offset, then `FXCODE_0B8751` (SuperFX expansion render)
   to draw the 6-tile fat sprite at the scaled offset.
3. The per-frame OAM frame is selected by `DATA_0E9B91` -- a 10-
   entry pointer table to sub-frame data blocks (`DATA_0E9BA5`..
   `DATA_0E9CB3`, 15 bytes each).

This is the only sprite in the Goonie family that uses SuperFX-
driven sprite scaling (the regular Goonie just shifts OAM Y).

### 3.3 Bowling Goonie ($158) -- the link to the Bowling Ball

`init_bowling_goonie` ($0E:9AB5) is unusual in that it *doesn't*
spawn the Bowling Ball. Instead it just sets up the initial state
$76=$0A (carry-and-drop posture), seeds $7402, $7542, $75E2 for
the carry pose, sets the OAM base to `$74A2 / $0843` (Bowling-
Ball gfx layer), and stashes the facing in $701902.

Inspection of the Bowling-Ball sprite ($148 LargeSpringBall? -- in
practice the ball is its own sprite via the level-data list, not
inline-spawned by the Bowling Goonie). The link is *implicit*:
the level data places a $158 and a separate ball-sprite next to
each other; the ball positions itself relative to the goonie via
its own init reading $701902. Unclear if the goonie has any explicit
slot-index reference to the ball (no `$78,x` writes by either init
observed); if level data is missing the ball, the goonie still runs
its 11-state main without complaint.

---

## 4. The Skeleton Goonie tribe ($19D / $19E / $19F, Bank0C)

The three Bank0C "skeleton" variants are the World-3 castle reskin.
Their movement model is fundamentally different from the regular
tribe: they don't use a state-ptr table at all. Instead each frame
of `main_skeleton_goonie` runs the same fixed sequence of helpers,
with mode-switches driven by `EXRAM_NorSpr_CurrentStatus` checks.

### 4.1 $19D Skeleton Goonie (the airborne variant)

Init at `$0C:9B6C`:

```
init_skeleton_goonie:
    LDY $7400,x
    LDA DATA_0C9B68,y     ; -$0100 / +$0100, per-facing X-speed
    STA XSpeed,x
    LDA #$0004
    STA $7A96,x           ; wing-flap-spawn cooldown
    LDA #$0008
    STA $7402,x           ; initial anim frame (mid-cycle)
    ASL : TAY             ; -> 16
    LDA DATA_0C9BBC,y     ; $0008 (initial Y-jitter)
    STA $7CD8,x           ; (Y-position cache for the SuperFX render)
    RTL
```

Note `$7CD8` is the canonical "cached-Y" field; storing the sine-
table value here makes the per-frame sine update look like a direct
position write. `DATA_0C9BBC` is a 9-entry sine-shaped Y-jitter
table ($0008, $0007, $0007, $0006, $0006, $0007, $0007, $0008,
$0008) -- a 9-frame loop with two bottom-out lows.

Main at `$0C:9B8A`:

1. If `CurrentStatus == $08` (stomped): spawn the feather ambient
   `$216` (4 copies via `CODE_0C9C8A`'s loop), then morph the slot
   in-place to $19E (wingless) via `JML CODE_spawn_sprite`. This
   is the "lose wings on stomp" mechanism.
2. Otherwise: `CODE_03AF23` (physics) -> `CODE_07E336` (a Bank07
   common-anim helper) -> `CODE_03A5B7` (Yoshi-touch / tongue) ->
   `CODE_0C9C23` (slot-link detach if held) -> `CODE_0C9BF2` (spawn
   wing-flap ambient $215 every random 0..$3F + $40 frames) ->
   `CODE_0C9BCE` (sine-table advance: decrements $7402 mod 9 per 4
   frames, copies new $7CD8 from the table).
3. Stomp routine `head_bop_skeleton_goonie` ($0C:9C48): calls
   `CODE_0C9C7B` (which plays `SoundID07_GoonieLoseWings` and
   spawns 5 randomized feather ambients $216 around the slot) then
   in-place morphs the slot to $19E (wingless), setting status $10.

### 4.2 $19E Wingless Skeleton Goonie (the after-stomp variant)

Init at `$0C:9CF3` is trivial -- it sets `$16,x = $0002` (state =
"falling"). Then a 3-entry state-ptr table at `DATA_0C9D0B`
(`DATA_skeleton_goonie_flightless_state_ptr`):

| `$16,x` | Handler      | Role |
|---------|--------------|------|
| `$00`   | `CODE_0C9D11` | **Walk.** Floor-touch wait; on touch arms $7A96 = $40 (wait timer) and advances state. (NB: the init never sets state $00 -- $19E always enters at state $02; this branch is reachable only if a future hand-off lands it there.) |
| `$02`   | `CODE_0C9D26` | **Fall + lateral drift.** Once $7A96 expires, sets X-velocity from `DATA_0C9CF9` (-$0200/+$0200), advances state. |
| `$04`   | `CODE_0C9D3B` | **Despawn-animate.** $7A96 cooldown; decrements $7402 by 1/2 frames (modulo 2 via wraparound at $0). |

`CODE_0C9CFD` (`main_skeleton_goonie_flightless`) just runs
`CODE_03AF23` (physics) -> `CODE_03A5B7` (touch) -> the state-ptr
dispatch. No SuperFX, no wing-flap ambient, no sine jitter.

### 4.3 $19F Skeleton Goonie Carrying Bomb

Init at `$0C:9D6C` is the most complex of the three. After running
the same flight-init as $19D (X-speed, $7402 = $08, sine-table
seed), it spawns a $060 Bomb sprite via `CODE_spawn_sprite_active`
and links the two slots:

```
init_skeleton_goonie_with_bomb:
    (...same X-speed + sine-table setup as $19D...)
    ; compute bomb's spawn X/Y from carry-pose tables:
    LDY $7400,x
    LDA $70E2,x : CLC : ADC DATA_0C9D56,y  ; DATA_0C9D56 = { +1, -1 }
    STA $00                                 ; bomb-X
    LDA $7182,x : CLC : ADC DATA_0C9D5A,y   ; DATA_0C9D5A = 9-entry Y offsets {$10..$11}
    STA $02                                 ; bomb-Y
    LDA #$0060 : JSL CODE_spawn_sprite_active
    BCC .no_bomb_slot
    TXA : STA EXRAM_NorSpr_GenericTable701978,y  ; bomb -> goonie back-pointer
    (...stamps initial bomb fuse + position...)
    TYA : STA $7A36,x   ; goonie remembers bomb slot in $7A36,x
    RTL
.no_bomb_slot:
    LDA #!Define_YI_NorSpr19D_SkeletonGoonie
    TXY : JML CODE_spawn_sprite          ; if no bomb slot, morph self into $19D
```

So `$7A36,x` doubles here as a slot-index (not a timer). The bomb
gets a back-pointer in `$701978,y` so it can detect goonie-stomp
and detach.

Main at `$0C:9DF4`:

1. `CODE_0C9F9D` (bomb-slot watchdog): if `$7A36,x` no longer
   points to a live $060 bomb (slot index >= $60, or status != $10,
   or sprite-ID mismatch), do an in-place morph back to $19D --
   the goonie loses its bomb and reverts to plain skeleton.
2. If `CurrentStatus == $08` (stomped while holding the bomb): set
   the bomb's $6FA2 to "armed/flashing" (`ORA #$001B`), its $7040
   to `ORA #$0004`, mark the bomb's $701978 to $0000 (detach), set
   bomb status to $0002 (Init pending = re-arm + start fuse),
   spawn 4 feather ambients $216, then morph self into $19E
   (wingless) -- the standard skeleton-goonie stomp result, but
   *also* freeing the bomb to fall.
3. Otherwise: run `CODE_03AF23` (physics) -> `CODE_0C9F76`
   (bomb-touch watchdog: if the bomb is touched / destroyed,
   despawn it), then `CODE_03A5B7`, the slot-link probes, and
   `CODE_0C9ED6` (carry-pose: position the bomb at the goonie's
   carry offset every frame).

### 4.4 The morph-on-status pattern

A subtle architectural choice: $19D / $19E / $19F all *change
sprite-ID in their own slot* rather than spawning a new slot. This
is done via `JSL CODE_spawn_sprite` (which preserves the slot but
re-loads Init for the new sprite-ID). The pattern:

```
LDA #!Define_YI_NorSprXXX
TXY                           ; pass slot index in Y
JSL CODE_spawn_sprite         ; re-init with new sprite-ID
```

Every morph chain in the skeleton tribe uses this:

- $19F -> $19D when the bomb is lost (init line 4041).
- $19D -> $19E when stomped (init line 3744 + main line 3744 + StompRt line 3832).
- $19F -> $19E when stomped while holding bomb (main 4070 + StompRt 4279).

The regular tribe doesn't use this pattern -- it relies on
in-handler state-byte writes instead.

---

## 5. Variant-encoding mechanisms

### 5.1 Sprite-ID branching (Pattern B from family-bandits.md)

`main_goonie` and `main_fat_goonie` use sprite-ID
`CMP`-and-branch to distinguish variants from a shared body. The
salient sites:

- `$0E:9608-961A` -- `CMP #!Define_YI_NorSpr155_FatGoonie / BEQ /
  CMP #!Define_YI_NorSpr158_BowlingGoonie / BNE` to pick the
  carry-pose gfx (Bowling Ball) vs the regular pose. This lives
  inside the shared pre-dispatch `CODE_0E95AE` and selects $74A2 /
  $6C00 / $6FA0 / $6FA2 differently per variant.
- `$0E:9779-9781` -- `CMP #!Define_YI_NorSpr0E8_Goonie / BEQ /
  CMP #!Define_YI_NorSpr153_GoonieWithShyGuy / BEQ` to gate the
  "drop the held egg" branch (only $0E8 and $153 do this).
- `$0E:9A65-9A67` -- `CMP #!Define_YI_NorSpr153_GoonieWithShyGuy
  / BNE / JSR CODE_0E94C4` to lazy-spawn the Shy Guy passenger
  inside state $0A (Yoshi-approach trigger). This is the
  "$153 doesn't get its Shy Guy until the goonie sees Yoshi"
  detail.

### 5.2 Shared label, fall-through init (Pattern C)

The regular tribe stacks labels heavily:

```
YI_NorSpr0E8_Goonie_Init:
init_goonie:
    LDA $701900,x : INC
    BEQ CODE_0E9433       ; jump to "common reset" -> falls into Shy-Guy entry
    LDA $7182,x : BIT #$0010
    BEQ CODE_init_goonie_with_shyguy   ; share with $153
    (...regular-Goonie init...)

YI_NorSpr153_GoonieWithShyGuy_Init:
CODE_init_goonie_with_shyguy:
    (...$153 init -- shared with $0E8 via the BEQ above...)
    (...if status check fails, falls through to:)
CODE_0E9433:                ; common reset state -- arm $7A96, set frame, state
    (...set initial timers, $76=$04, gfx base, exit...)
    RTL
```

The result: $0E8 / $0E9 / $153 share the same physical Init body,
discriminated only by their entry point + a $7182 bit-4 check.
This is the cleanest example of the "stacked label, branch-or-
fallthrough" idiom in the Goonie family.

### 5.3 Sprite-ID rewrite (the $153 -> $0E8 trick)

Inside `CODE_0E94C4` (the Shy Guy spawn helper for $153), the
final line is:

```
    LDA #!Define_YI_NorSpr0E8_Goonie
    STA EXRAM_NorSpr_SpriteID,x
    RTS
```

After the Shy Guy is spawned and linked, the $153 slot **re-tags
itself as $0E8**. The Shy Guy's `7019D6 = 3` flag is what keeps
the visual "Goonie carrying Shy Guy" effect; once the Shy Guy
drops off (or is killed), the goonie is indistinguishable from
a regular $0E8.

This is unusual: most "carrier" sprites in YI keep their original
sprite-ID for the entire flight (the Baron Von Zeppelin family,
for instance, carries its payload identity for life). The Goonie's
slot rewrite is the cleanest expression of "the passenger is the
distinguishing feature; the bird is just a bird".

---

## 6. Spawn / parent relationships

Where do Goonies come from in a level?

| Source                    | Mechanism                              | Notes |
|---------------------------|----------------------------------------|-------|
| Level data                | Sprite-list entry with ID $0E8 / $0E9 / $153 / $155 / $158 | Standard init path. Most beach + cave stages place $0E8 spawners at level edges. |
| Level data                | Sprite-list entry with ID $19D / $19F | World-3 castle (Bigger Boo's Fort + Naval Piranha's room). $19E never appears in level data -- it's always a morph result. |
| Edge-respawn ($0E8 cycle) | `CODE_0E957A` + `$0C7C` counter        | A live $0E8 spawns continuous fresh $0E8 instances from the off-screen edge until the global counter is cleared. See §2.2. |
| Flock spawn ($0E9 parent) | `CODE_0E9399` loop + $18,x flag        | The parent $0E9 spawns 2 child $0E9 slots with staggered X-offsets {$10, $20}. |
| Stomp morph ($19D -> $19E) | `JSL CODE_spawn_sprite` in StompRt + main | $19D becomes $19E in-slot when stomped. |
| Bomb-loss morph ($19F -> $19D) | `JML CODE_spawn_sprite` at line 4043 | $19F becomes plain $19D if it loses its bomb partner. |
| Stomp morph ($19F -> $19E) | `JSL CODE_spawn_sprite` in StompRt + main | $19F also becomes $19E on stomp; the bomb is freed simultaneously. |
| Test mode                 | Debug menu                             | Not relevant to gameplay. |

A few details worth pulling out:

**The flock counter is global, not per-slot.** $0C7C is a single
word that all Goonie slots check. This means a level can have any
number of distinct $0E8 entries in its sprite list and they will
all collaborate to keep the counter non-zero; clearing it requires
either the level transitioning out (gamemode reset) or every
$0E8 slot reaching the despawn branch simultaneously.

**No goonie spawns another goonie type.** Within the regular tribe,
$0E8 spawns $0E8, $0E9 spawns $0E9, $153 doesn't spawn $0E8 (it
*re-tags* itself). Within the skeleton tribe, $19D / $19F morph to
$19E or $19D (lateral, not multiplicative). There's no spawner-
of-mixed-payloads pattern here -- contrast with the Bandit family's
WingedCloud / Bucket / Zeppelin chains.

**Shy-Guy passenger lifecycle is lazy.** $153's Shy Guy is *not*
spawned by `init_goonie_with_shyguy`. It's spawned by
`CODE_0E94C4`, which is invoked from state $01 (post-launch
trigger) of `main_goonie` *only* when Yoshi enters approach range.
A $153 that the player never approaches will run its full flight
cycle solo and pass off-screen without ever carrying a passenger.
The $153 slot is also retagged to $0E8 at the same instant the
Shy Guy spawns -- so a player who never enters approach range
sees only a $0E8 from the moment of approach onward (visually
they look identical to other Goonies once the passenger has
either dropped or never appeared).

---

## 7. Open questions / unclarities

- **State $01 (post-launch) is not in the state-ptr table.** The
  ptr-table has 7 entries (states $00..$06); after-launch
  transitions to state $76 = $01 happen inside `init_goonie`'s
  fall-through reset block ($0E:943B onwards). The $01 value
  appears to be reached only briefly before the next state-dispatch
  bumps it. Likely intentional -- the dispatcher's "ASL : TAX"
  means state $01 indexes into the table the same as state $00
  (entry $02 byte-offset = $00 + $02), so $01 effectively *is*
  state $00 from a dispatch perspective. Unclear if this is a
  deliberate aliasing or a state-byte-byte vs state-index-word
  encoding accident.
- **`$0C7C` lifecycle.** Set to 1 on first $0E8 init; never
  observed being decremented or cleared except by the edge-despawn
  branch (`CODE_0E9576` runs JML CODE_03A31E which doesn't touch
  $0C7C). A "spawn forever" feel might be unintentional --
  unclear how this is reconciled with level-end despawn.
- **Bowling Goonie ball linkage.** `init_bowling_goonie` doesn't
  spawn a ball or set up an explicit slot link. The ball must be
  level-placed adjacent. Confirm via a level dump of the Bowling
  Goonie stages -- the level-data must place both sprites in the
  same column. The "drop" mechanism (the ball falls when the goonie
  passes overhead) is therefore implicit / proximity-driven, not
  explicit slot-mirror.
- **What is `$74A2,x = $FF`?** Several handlers (`CODE_0E9608`,
  state $0A) set $74A2 to $FF. Comparing against other sprites,
  this is the "rear / behind-Yoshi" gfx priority bit. The Goonie
  uses it during the "fly out of Yoshi's reach" branch -- the
  goonie ducks behind background terrain.
- **Skeleton Goonie sine table reuse.** `DATA_0C9BBC` is used by
  both $19D and $19F (with the same 9-entry sine shape). $19F's
  init also calls `DATA_0C9D5A` (a 9-entry positive table $10..$11)
  for the carry-pose Y offset. The matching counts suggest both
  tables share the same 9-frame loop driver. Unclear why $19F has
  a parallel table rather than sharing $19D's.

---

## 8. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` -- canonical sprite IDs and
  one-line summaries for `$0E8`, `$0E9`, `$153`, `$155`, `$158`,
  `$19D`, `$19E`, `$19F`.
- `yi/Constants/AmbientSpriteIDs.asm` -- the three ambient sprites
  spawned by Goonie variants: `$1E7` (death-pop, regular tribe),
  `$1FF` (death-pop debris), `$211` (large-explosion expansion --
  unclear if Goonie path actually reaches this), `$215` (wing-
  flap, skeleton tribe), `$216` (feather, skeleton tribe).
- `yi/Constants/SoundIDs.asm` -- `SoundID03_Swim` (Fat Goonie
  ascent), `SoundID07_GoonieLoseWings` (skeleton stomp),
  `SoundID0B_ShellHit1` (slot-link detach impact),
  `SoundID13_SpringBounce` (Skeleton-Goonie engagement).
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_main`, `spr_state_on_head_bop`, etc.) that runs
  `main_goonie` / `main_fat_goonie` on every alive Goonie slot.
  Goonie family does not use the per-sprite StompRt -- it routes
  through the shared `head_bop_common` (RTL) and handles stomp
  cleanup inline in main via `CODE_0E95AE`'s status check.
- `docs/family-shyguys.md` -- the Shy-Guy side of $153
  (`init_shyguy` at $04:1170, the `7019D6 = 3` "riding-goonie"
  payload tag, the shared 9-state shy-guy main).
- `docs/leveldataengine.md` -- how sprite-list entries spawn
  Goonie slots from the level header.
- `yi/Banks/Bank0E.asm` -- the regular-tribe implementation:
  `init_flightless_goonie` (line 2555), `init_goonie` (2610),
  `CODE_init_goonie_with_shyguy` (2648), `CODE_0E94C4` Shy-Guy
  spawn helper (2719), `DATA_goonie_state_ptrs` (2759),
  `main_goonie` (2775), `CODE_0E95AE` shared pre-dispatch (2850),
  `CODE_0E9561` edge-respawn (2814), `CODE_0E9638` SuperFX
  intersection (2917), `CODE_0E9885` death-pop helper (3190),
  `init_fat_goonie` (3462), `init_bowling_goonie` (3471),
  `DATA_fat_goonie_state_ptrs` (3537), `main_fat_goonie` (3559),
  `CODE_0E9CED` fat-goonie scaled SuperFX render (3656),
  `CODE_0E9DC0` (3747), `CODE_0E9E86` proximity check (3831).
- `yi/Banks/Bank0C.asm` -- the skeleton-tribe implementation:
  `init_skeleton_goonie` (3714), `main_skeleton_goonie` (3735),
  `DATA_0C9BBC` sine table (3757), `CODE_0C9BCE` sine advance
  (3761), `CODE_0C9BF2` wing-flap spawn (3781), `CODE_0C9C23`
  slot-link probe (3802), `head_bop_skeleton_goonie` (3827),
  `CODE_0C9C7B` feather-burst + sound (3843),
  `init_skeleton_goonie_flightless` (3902),
  `main_skeleton_goonie_flightless` (3917),
  `DATA_skeleton_goonie_flightless_state_ptr` (3926),
  `init_skeleton_goonie_with_bomb` (3984),
  `main_skeleton_goonie_with_bomb` (4049),
  `CODE_0C9ED6` carry-pose (4138), `CODE_0C9EFE` (4158),
  `CODE_0C9F76` bomb-touch watchdog (4211),
  `CODE_0C9F9D` bomb-slot watchdog (4233),
  `head_bop_skeleton_goonie_bomb` (4270).
- `yi/Banks/Bank03.asm` -- `head_bop_common` (the shared RTL stub
  at line 3543/3544 that all regular-tribe Goonie StompRt /
  RideYoshiRt labels alias to); `CODE_03A5B7` (5220, the
  "Yoshi-touch / transfer carried item" routine all Goonies call
  per-frame); `CODE_03AE60` (6351, gravity init); `CODE_03AF23`
  (6486, the standard per-frame physics + anim tick);
  `CODE_03B25B` (6895, the "forced-detach" path used by the
  catch-thrown-egg branch in `main_goonie`).
- `yi/Banks/Bank0D.asm` -- `CODE_0DC0F0` (8318), the
  tongue-eat-completion hook that converts a tongued Goonie into
  an egg via `CODE_04906C` / `CODE_03B25B`.
- `yoshisisland-disassembly/disassembly/bank0E.asm` -- Raidenthequick's
  descriptive labels: `init_goonie`, `init_flightless_goonie`,
  `init_fat_goonie`, `init_bowling_goonie`, `main_goonie`,
  `main_fat_goonie`. Verified label-by-label.
- `yoshisisland-disassembly/disassembly/bank0C.asm` -- Raidenthequick's
  labels for the skeleton tribe: `init_skeleton_goonie`,
  `main_skeleton_goonie`, `head_bop_skeleton_goonie`,
  `init_skeleton_goonie_flightless`,
  `main_skeleton_goonie_flightless`,
  `init_skeleton_goonie_with_bomb`,
  `main_skeleton_goonie_with_bomb`, `head_bop_skeleton_goonie_bomb`.
  Verified label-by-label.
- `ys_enmy0.asm` / `ys_enmy3.asm` / `ys_enmy*.asm` -- parallel
  engine asm for the bird-flyer family. Same physical structure
  (state-ptr table + shared init body + sprite-ID rewrite for
  the passenger variant), same lifecycle.
