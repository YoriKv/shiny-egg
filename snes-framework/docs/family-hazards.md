# YI Environmental hazards family reference

Standalone reference for the Yoshi's Island "environmental hazard"
sprite family -- the lava bubbles, lava logs, lava drops, falling
stones, falling walls, falling rocks, falling icicles, snowballs,
and Hot Lips. Unlike the enemy families this is a *functional*
grouping: 14 normal-sprite IDs spread across five banks that all
answer roughly the same engine-level contract -- they're scenery
that hurts (or splatters, or crushes) on contact, with no real
enemy AI, no per-state Yoshi tracking, and almost no head-bop
response. Most of them never have a "kill" verb at all; they
either run out of states (icicle shatters, snowball off-screens,
falling stone crumbles into Map16), or they cycle forever on a
schedule (lava bubble, Hot Lips, lava drop).

The family is unusual in three ways:

- **Mostly schedule-driven, not Yoshi-driven.** Where Bandits poll
  Yoshi position every frame and switch states based on distance,
  most hazards run a fixed-period timer (`$7A96,x` or `$7A98,x`)
  and only sample Yoshi position at fence-post moments. The Lava
  Bubble straight variant is the extreme case -- it doesn't read
  Yoshi's X at all; it just pops up where it was spawned.
- **Heavy use of level-header gating.** Three hazards
  (`$01B`, `$0DC`, `$1AA`) widen / shrink / re-anchor their
  collision and animation based on the level's BG1 tileset
  (`!RAM_YI_Level_LevelHeaderBG1TilesetLo`). The lava tilesets
  `$03` and `$0D` are the trigger; on other tilesets the same
  sprite spawns with smaller collision so it stays visually flush
  with non-lava (frozen lake) terrain.
- **No StompRt.** None of these sprites bounce Yoshi when stomped
  in the normal sense. The four-stomp / head-bop common stub in
  Bank03 either falls through to the global "alias to head-bop-
  common-RTL" or simply isn't installed; the engine treats every
  hazard contact as either non-event (Yoshi can stand on the
  falling rock, the lava log, Hot Lips' head) or as a damage event
  (lava bubble, lava drop, falling stone crush).

This doc complements:

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_init`, `spr_state_main`, `spr_state_on_head_bop`,
  `spr_state_on_ride_yoshi`) that runs each hazard's Main from the
  `$10` (active) engine-state slot.
- `docs/bossengine.md` -- §4 covers Blargg ($194), the lava mini-
  boss whose "submerge / leap / re-submerge" rhythm is a scaled-up
  version of the Lava Bubble's two-state machine; it's not in
  this doc because Blargg's full state machine + dyntile pipeline
  belongs with the boss family.
- `docs/family-platforms.md` -- the platform family has parallel
  "stand-on-this" mechanics for friendly equivalents like Donut
  Lift, buoyant round platform, and unstable snow. The Lava Log
  ($000) is on the edge between the two families -- physically
  Yoshi can ride it, but its movement model bobs entirely on the
  lava surface; see §2 below.
- `docs/leveldataengine.md` -- the `LevelHeaderBG1TilesetLo`
  encoding (`$03` = lava, `$0D` = lava-variant, `$0A` = dark
  castle) is the gate for half this family's variant behavior.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank02.asm` (Falling Wall $036, Lava Log $000, Falling
Rock Platform $0DE, Falling Stones $137-$13A), `Bank04.asm`
(Vertical Lava Log $01B), `Bank05.asm` (Straight + Following
Lava Bubbles $080 / $081), `Bank07.asm` (Horizontal + Vertical
Lava Drops $12F / $130), `Bank0C.asm` (Falling Icicle $190,
Hot Lips $1AA), and `Bank0E.asm` (Snowball $0DC). Cross-checked
against Raidenthequick's `bank0[2457CE].asm` descriptive labels:
`init_lava_bubble`, `main_lava_bubble`, `init_lava_bubble_arcing`,
`init_floating_log`, `main_log`, `init_lava_log`, `main_lava_log`,
`init_lava_drop_horizontal`, `init_lava_drop_vertical`,
`init_falling_rock`, `main_falling_rock_common`,
`init_falling_rock_common`, `init_falling_wall`,
`main_falling_wall`, `init_falling_icicle`, `main_falling_icicle`,
`init_hot_lips`, `main_hot_lips`, `init_snowball`,
`main_snowball`, and the parallel sources `ys_lava*.asm`,
`ys_rock*.asm`, `ys_fall*.asm`, `ys_ice*.asm`, `ys_snow*.asm`,
`ys_enmy*.asm`.

---

## 1. Family at a glance

Fourteen sprites across five banks. Sub-family columns map to
sections §2-§6 below.

| ID | Name | Bank | Init | Main | Sub-family |
|---|---|---|---|---|---|
| `$000` | LavaLog | 02 | Bank02:11169 `init_floating_log` | Bank02:11197 `main_log` | §3 Lava logs |
| `$01B` | VerticalLavaLog | 04 | Bank04:1232 `init_lava_log` | Bank04:1259 `main_lava_log` | §3 Lava logs |
| `$036` | FallingWall | 02 | Bank02:162 `init_falling_wall` | Bank02:248 `main_falling_wall` | §6 Falling rocks/other |
| `$080` | StraightLavaBubble | 05 | Bank05:1912 `init_lava_bubble` | Bank05:1936 `main_lava_bubble` | §2 Lava bubbles |
| `$081` | FollowingLavaBubble | 05 | Bank05:2098 `init_lava_bubble_arcing` | Bank05:1937 (shared) | §2 Lava bubbles |
| `$0DC` | Snowball | 0E | Bank0E:9376 `init_snowball` | Bank0E:9396 `main_snowball` | §7 Snow / ice |
| `$0DE` | FallingRockPlatform | 02 | Bank02:2940 `init_falling_rock` | Bank02:2987 `main_falling_rock_common` | §6 Falling rocks/other |
| `$12F` | HorizontalLavaDrop | 07 | Bank07:5412 `init_lava_drop_horizontal` | Bank07:5451 `main_lava_drop_horizontal` | §4 Lava drops |
| `$130` | VerticalLavaDrop | 07 | Bank07:5542 `init_lava_drop_vertical` | Bank07:5601 `main_lava_drop_vertical` | §4 Lava drops |
| `$137` | 3x6FallingStone | 02 | Bank02:3153 (shared `init_falling_rock_common`) | Bank02:3188 (shared) | §5 Falling stones |
| `$138` | 3x3FallingStone | 02 | Bank02:3154 (shared) | Bank02:3189 (shared) | §5 Falling stones |
| `$139` | 3x9FallingStone | 02 | Bank02:3155 (shared) | Bank02:3190 (shared) | §5 Falling stones |
| `$13A` | 6x3FallingStone | 02 | Bank02:3156 (shared) | Bank02:3191 (shared) | §5 Falling stones |
| `$190` | FallingIcicle | 0C | Bank0C:88 `init_falling_icicle` | Bank0C:106 `main_falling_icicle` | §6 Falling rocks/other |
| `$1AA` | HotLips | 0C | Bank0C:7605 `init_hot_lips` | Bank0C:7656 `main_hot_lips` | §2 Lava bubbles |

Cross-reference, *not* documented here:

| ID | Name | Bank | See |
|---|---|---|---|
| `$194` | Blargg | 03 | `docs/bossengine.md` §4 -- the lava mini-boss. Behaves like a giant Lava Bubble but with a multi-state submerge / leap / damage payload machine and its own dyntile pipeline. |

Of the 14 in-scope sprites, only 7 are "true" hazards in the sense
that contact with Yoshi kills him outright (lava bubbles, lava
drops, lava logs in lava sets, Hot Lips, the falling stone family,
the falling wall). The other 7 are more "transient" -- the
falling rock platform crumbles, the icicle shatters on impact,
the snowball off-screens. See §8 (Damage delivery) for the
classification.

---

## 2. Lava-bubble sub-family ($080 Straight, $081 Following, $1AA Hot Lips)

Three sprites whose common idea is "a thing leaps out of the lava
surface". They differ in trajectory math (vertical vs arcing) and
in whether the protruding shape is a discrete projectile (the
bubbles) or a permanent feature of the floor (Hot Lips).

### 2.1 Shared spawn pattern

Both $080 and $081 Init handlers do nearly identical work
(Bank05.asm:1912 + 2098):

```
$058CC6 / $058E1B init_lava_bubble[_arcing]:
    LDA $7182,x                                   ; spawn-Y
    STA $701902,x                                 ; <-- "resting lava-line" snapshot
    SEP #$20
    LDA #$FF
    STA $7863,x                                   ; <-- high-priority OAM flag
    REP #$20
    RTL
```

That single `$7182,x -> $701902,x` write is the only thing
distinguishing the two sprites' init bodies. Main looks up the
sprite ID via `!EXRAM_YI_Level_NorSpr_SpriteID,x` and dispatches
to either the 2-entry straight-bubble state ptr at
`DATA_lava_bubble_state_ptr` (`$058CD6`) or the 6-entry arcing
state ptr at `DATA_lava_bubble_arc_state_ptr` (`$058E2B`).

`$701902,x` (alias `_GenericTable701902`) is the
**lava-surface anchor** for both variants -- the Y-coord the
bubble re-emerges to when it sinks. Main writes back to
`$7182,x` from `$701902,x` to "reset to lava level" at the end
of the descend arc.

### 2.2 Straight bubble ($080) -- 2-state main

The 2-entry table at `DATA_lava_bubble_state_ptr` (Bank05.asm:1928):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_058D45` (Bank05.asm:1993) | **In flight.** Wait for `$7A98,x` cooldown + a CODE_03AD74 trigger gate; on trigger, randomise launch X-direction (`$10 AND #$0002`), seed Y-speed = `$FD34` (up), play SoundID39 PiranhaPlantMunch, advance to state $02. |
| `$02` | `CODE_058D82` (Bank05.asm:2021) | **Falling back into lava.** When Y-position crosses below the saved `$701902,x` lava-line, snap back to it, zero Y-speed, run CODE_03AEFD (splash sound + Map16 settle), set $7863=$FF, seed a $0060 cooldown timer, drop back to state $00. |

Main shared body (Bank05.asm:1937 + falls through `CODE_058CDA`
for both sprites) also handles the **rising splash ambient
spawn**: every time Y-position passes a $20-step threshold while
in flight, spawn an `!Define_YI_AmbSpr1D6` sprite (3-stage flicker
animation; `$058CF8` checks the spawn-trigger gate). The spawn
copies the bubble's `$70E2,x` into `$70A2,y` and the bubble's
`$7182,x` into `$7142,y` -- so the splash appears at the same
column as the bubble.

The straight variant has no horizontal motion, no Yoshi-tracking,
and no per-frame state change inside flight; it's purely a "wait,
launch, gravity, splash" timer. The sound cue (`$39
PiranhaPlantMunch`) plays exactly once at launch.

### 2.3 Following bubble ($081) -- 6-state main

The 6-entry table at `DATA_lava_bubble_arc_state_ptr`
(Bank05.asm:2111):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_058F11` (Bank05.asm:2226) | **Submerged in lava.** Same gating as straight bubble ($7A98 cooldown + CODE_03AD74), but the X-speed is selected from `DATA_058F0D` indexed by `$77C2,x` (the engine's "facing toward Yoshi" reference) -- so the arc tracks the player. Y-speed is `$FD34` (same as straight). |
| `$02` | `CODE_058F57` (Bank05.asm:2254) | **Arc rise.** Same "Y-crosses-back-to-lava" check; on land-back, runs splash/cooldown like straight $02. Otherwise it walks `$7860,x` (floor-bit) to switch to state $04 if a wall is hit (the bubble bonks against geometry). |
| `$04` | `CODE_05908F` (Bank05.asm:2407) | **Apex / start of descent toward Yoshi.** Re-evaluates the arc direction; this is the "I'm now falling toward the player" state. |
| `$06` | `CODE_0590B4` (Bank05.asm:2461 area) | **Descent arc.** Continued horizontal sweep with falling Y-speed. |
| `$08` | `CODE_059118` | **Splash settle.** Sets up a 4-frame visible splash animation. |
| `$0A` | `CODE_059151` | **Post-splash cooldown.** Idles until the cooldown timer expires, then back to state $00. |

The arc bubble *also* periodically spawns `!Define_YI_AmbSpr1D6`
splash sprites at every $20-step Y-threshold during states $00,
$02, and on splash. See the splash-spawn block at `CODE_058E7C`
(Bank05.asm:2154). The descend states $06 + $08 *suppress* the
periodic splash (mask `AND #$0007` BNE skip) -- so the bubble's
visual trail is dense on the way up and on splash, sparse on
the way down.

The 8-entry `DATA_058E37` (Bank05.asm:2120) is the **launch
X-speed table** (`$0080 / $0100 / $0180 / $0200 / $FF80 / $FF00 /
$FE80 / $FE00`); index is `($10 frame counter) AND #$0006 + DATA_058E47[y]`,
which gives 4 forward + 4 reverse speeds. The selected index is
randomised every spawn so the arc is non-deterministic.

### 2.4 Hot Lips ($1AA) -- 9-state machine

Bank0C.asm:7605 `init_hot_lips`. The init re-anchors the spawn-Y
upward by 4 pixels (or 8 if BG1 tileset = `$03`, the primary lava
tileset), copies the result to both `$7182,x` (display-Y) and
`$7A38,x` (rest-Y anchor), seeds the OAM-pose index from
`DATA_0CBA90` (`$01,$02,$03,$02,$01,$00` -- a 6-frame walk of
"lips closed"), and sets initial state $76 = $00.

Main (Bank0C.asm:7656) drives a 9-entry state table at
`DATA_hot_lips_state_ptr` (`$0CBA7E`):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0CBA9C` | **Idle.** Pre-pucker -- waits for Yoshi to enter the X-window (`$7CD6 - $611C + $80 < $100`), then advances to state $02 with a Y-speed of `$FE00` (rising slowly) and the "pucker" OAM pose. |
| `$02` | `CODE_0CBAF3` | **Pucker rise.** Lips lift up to 4 pixels above `$7A38,x` then halt (Y-speed = 0, ground-flag = 0); start the inhale animation timer ($7A98 = $D1). |
| `$04` | `CODE_0CBB2F` | **Inhale.** Animate through `DATA_0CBB27` (`$07,$06,$05,$00` -- inhale OAM) at hold-times `DATA_0CBB2B` (`$02,$30,$08,$50`); on timer-end, set `$7A98=$D1` and advance to state $06. |
| `$06` | `CODE_0CBB6C` | **Suck-in / pull.** Polls `$7A98,x` (the inhale timer); each `$08`-frame tick increments `$16,x` (suck progress) and spawns a `!Define_YI_AmbSpr21B` flame-spit ambient via `CODE_0CBD09` to draw the inhaled-air trail. Advance to state $08 when `$7A98=0` or the pull animation reaches index $12. |
| `$08` | `CODE_0CBB9B` | **Reverse-suck (build pressure).** Walks the suck index back down at 1-tick-per-frame; when it reaches 0, start the "blow" arc -- $7A98=$80, X-pose= $00,$01,$00,$04 (4-frame pulse), seed Y-speed `$0200` (descend) on transition to state $0A. |
| `$0A` | `CODE_0CBBD9` | **Blow / exhale.** If Yoshi is in the wider X-window (`$7CD6 - $611C + $A0 < $140`), set Y-speed `$0200` and POSE $0 (blow-out), advance to state $0C. Otherwise animate through `DATA_0CBBD1`/`DATA_0CBBD5`. |
| `$0C` | `CODE_0CBC3E` | **Settle back to anchor.** When `$7A38,x` <= `$7182,x` (the lips have returned to lava-line), zero Y-speed and re-init via the shared `CODE_0CB92C` body. |
| `$0E` | `CODE_0CBC58` | **Linger underwater.** Sub-state $16 controls whether the lips dip below anchor; idles for $0140 frames before re-firing. |
| `$10` | `CODE_0CBCAE` | **Final cooldown.** Re-rise to anchor with Y-speed `$FE00`, then back to `CODE_0CB92C` (re-init). |

The **render path** is unique to Hot Lips: every frame Main calls
`FXCODE_089822` with embedded sprite-list `DATA_0CB944` (80
entries -- 5 lip poses x 8 tiles each) and offset table
`DATA_0CB9E4` (36 word entries -- the per-tile X/Y deltas from the
center). That gives a 5-pose mouth that opens / closes / puckers
without using the OAM-cluster system the rest of the family uses.

The splash trail on state $06 / $0A spawns `!Define_YI_AmbSpr21B`
sprites (2-frame countdown). Each pull-frame copies the lips'
`$70E2 + DATA_0CB9E4[$16,x * 4]` to the ambient `$70A2,y` -- so
the inhaled-air trail extends out along the per-pose offset
table.

---

## 3. Lava-logs sub-family ($000 Floating, $01B Vertical)

Two sprites whose shared idea is "a log floating on lava". The
horizontal floating log $000 is the canonical "ride this across
the lava pool" platform; the vertical lava log $01B bobs up and
down without horizontal motion. Both register Yoshi-stand-on
behavior via the per-frame `$61B4 / $61B6` ride sentinel and
neither has a damage payload of its own.

### 3.1 Lava Log ($000) -- horizontal float

Bank02.asm:11169 `init_floating_log` does only three things:

```
$02E1EB init_floating_log:
    JSL CODE_03AE60                               ; engine init shared with logs/floats
    STZ $7400,x                                   ; reset facing
    SEP #$20
    LDA #$FF
    STA $7863,x                                   ; high-priority OAM
    REP #$20
    RTL
```

`CODE_03AE60` is a shared "spawn lazy-init marker" helper -- it
sets `$7862,x = $00` so Main's first execution detects "I haven't
initialised the bob-physics yet" and computes a fresh oscillation
based on the camera's current Y-position. The lazy-init is the
mechanism that lets the log work on any lava-Y elevation in any
level without needing per-level constants in its data tables.

Main (Bank02.asm:11197) walks a long bob-physics loop:

- **Bob amplitude table** `DATA_02E1FC` (42 entries; values
  $0002,$FFFE,$01E0..$0020) -- the sine-like vertical position
  pattern.
- **Bob period table** `DATA_02E258` (9 entries;
  $0080,$0030..$0008) -- how many frames per bob step. The
  period depends on the log's current Y-speed; faster logs cycle
  through tiles faster.
- **X-speed deltas** `DATA_02E250` (4 entries; `$0004,$0000,
  $0006,$FFFF`) -- horizontal drift acceleration based on
  Y-direction and previously-set facing.

The physics loop:

1. Apply gravity via `CODE_03AF23` (Y-speed += $0020, capped
   at -$80).
2. If `$7860,x & $0001` (floor-touch bit) is set, jump to state
   `CODE_02E2D1` (re-anchor to floor).
3. Otherwise, sample the per-period table at
   `DATA_02E258,y` where `y = (Y-speed * 8) AND #$E`, write
   to `$7AF6,x` (the next-bob-tick timer).
4. Apply the bob amplitude via `DATA_02E1FC` indexed by current
   tick into `$7A36,x` (X-bob).
5. Subtract `$60AA / $60AC` (camera X/Y deltas) -- the log
   slowly drifts opposite the camera so it feels anchored to a
   specific lava-pool position.

This is the only sprite in the family that uses
`FXDATA_0BB810` for **inter-log X-distance LUT lookups** -- the
floats in W3-3 / W6-7 are arranged in chains and the per-log code
samples the neighbor's X-position to ensure the chain doesn't
overlap or separate too far.

Yoshi can stand on the lava log without damage; the engine's
ride-on-sprite primitive at `$61B6 / $61B4` is the mechanism (see
`docs/family-platforms.md` §0). The log's hitbox is wide enough
to be a platform but narrow enough that the gap between logs is
deadly (Yoshi falls into the lava under-surface, which is its own
floor-tile damage type, not a sprite-collision).

### 3.2 Vertical Lava Log ($01B) -- vertical bob

Bank04.asm:1232 `init_lava_log` -- the "lava-tileset detection"
pattern:

```
$0488BC init_lava_log:
    SEP #$20
    LDA #$FF
    STA $7863,x
    REP #$20
    LDA #$0008                                    ; default $0008 collision-width
    LDY !RAM_YI_Level_LevelHeaderBG1TilesetLo
    CPY #$03                                      ; lava tileset?
    BEQ widen
    CPY #$0D                                      ; lava variant?
    BNE narrow
widen:
    LDA #$FFF6                                    ; -10 pixel offset (wider collision)
narrow:
    STA $7720,x
    STA $16,x
    RTL
```

The init *widens the collision box* when the level header
declares BG1 tileset $03 or $0D (the lava tilesets). On other
tilesets (e.g., frozen lake reskin variants), the same sprite
spawns with `$0008` collision -- the narrower box so the log
looks correct against a non-lava surface.

Main (Bank04.asm:1259) is a single-state bob:

- Falling: `$7862,x = 0` (no floor); decelerate Y-speed +$0008
  per frame, clamp to `$0080`.
- Rising (Y-speed BPL): Y-speed -= $0008, clamp to `$FF80`.
- On floor-touch: Z-snap (`>>3 EOR INC ADC #$FFFC` etc.) to
  re-anchor to the lava-surface tile.
- If Yoshi is currently on top: apply the log's Y-delta to
  Yoshi's Y (lines 1314-1335) and update `$60AA` to clear the
  stand-on-sentinel if descending (so Yoshi falls off when the
  log dips below the surface).

The vertical log also writes `$61B4 = +1` per frame (line 1352)
which is the engine's "Yoshi is currently riding a vertical-bob
sprite" flag.

---

## 4. Lava-drop sub-family ($12F Horizontal, $130 Vertical)

Bank07. Two sprites that share an identical "ping-pong between
two endpoints" mechanic. The horizontal variant oscillates X
between two pixel positions; the vertical variant oscillates Y.
Both spawn periodic splash ambients at each endpoint.

### 4.1 Endpoint anchors

Shared `DATA_lava_drop_x_endpoint_offset` (Bank07.asm:5405) at
`$07AB49`:

```
DATA_lava_drop_x_endpoint_offset:
    dw $FFD0,$0030     ; left endpoint = spawn-X - 48; right = spawn-X + 48
```

Shared `DATA_lava_drop_x_speed` at `$07AB4D`:

```
DATA_lava_drop_x_speed:
    dw $FE00,$0200     ; left-going = -512, right-going = +512 subpixel/frame
```

Both sprites use the same endpoint/speed tables but apply them to
different axes -- the horizontal variant writes to
`!EXRAM_YI_Level_NorSpr_XSpeedLo` and the vertical to
`!EXRAM_YI_Level_NorSpr_YSpeedLo`. That's the only structural
difference between the two Inits.

### 4.2 Horizontal Lava Drop ($12F)

`init_lava_drop_horizontal` (Bank07.asm:5412):

1. Save `$70E2,x + $FFD0` to `$18,x` (left endpoint).
2. Save `$70E2,x + $0030` to `$76,x` (right endpoint).
3. Seed `$7540,x = $0004` (active state).
4. Pick initial direction from `($70E2,x AND #$0010) >> 3 EOR
   #$0002` -- so the initial facing depends on the X coordinate
   bit 4 (so two adjacent drops face opposite directions
   without per-instance setup).
5. Apply that direction's X-speed.
6. Seed `$7A96,x = $0003` (anim cooldown).

Main (Bank07.asm:5451) `main_lava_drop_horizontal`:

- Apply gravity via `CODE_03AF23`.
- If X-speed = 0, check `$7A96,x` for cooldown completion + walk
  the 8-entry `DATA_07AB90` "endpoint pose" table (which holds
  the brief "settle / wobble" animation at the endpoint).
- If X-speed != 0, test if position is between $18,x (left)
  and $76,x (right); if past either, hit the bounce branch
  `CODE_07AC05`: snap to endpoint, zero X-speed, zero `$7540`,
  re-arm with 7-frame "pause at endpoint" via `$78,x = $0007`.
- Periodic splash spawn: every 7 frames in motion (`$14 AND #$0007`),
  spawn an `!Define_YI_AmbSpr1FA` sprite at the drop's center -
  position pulled from `$70E2 + DATA_07AB98[$7400]` to alternate
  the splash side.

### 4.3 Vertical Lava Drop ($130)

`init_lava_drop_vertical` (Bank07.asm:5542) is the same shape as
horizontal but with axis swaps + an additional **variant
selector** at the end:

```
LDA $70E2,x AND #$0010 LSR LSR LSR EOR #$0002
STA !EXRAM_YI_Level_NorSpr_GenericTable701976,x  ; <-- visual variant
```

`DATA_07ACCA[$2]` and `DATA_07ACCE[$2]` are pointer pairs
selected by this variant byte; they dispatch to one of four
4-byte tile tables (`DATA_07ACB2,B6,BA,C2`). The drop's
OAM-pose sequence comes from `($00),y` where `$00 =
DATA_07ACCA[variant]` -- so the drop "splashes upward" or
"splashes downward" depending on the variant.

Main (Bank07.asm:5601) `main_lava_drop_vertical` is structurally
the same as the horizontal version but:
- Endpoint test against `$7182,x` (Y) not `$70E2,x` (X).
- Spawn `!Define_YI_AmbSpr1FB` (vertical splash) instead of
  `1FA` (horizontal splash).
- Pose lookup walks `($00),y` per-frame to animate the splash
  tile through the variant's 4-entry sequence.

---

## 5. Falling-stone sub-family ($137-$13A)

Four variant IDs that share **a single Init body and a single
Main body**. The variant byte is the SpriteID itself: Init
reads `!EXRAM_YI_Level_NorSpr_SpriteID,x - !Define_YI_NorSpr137`
to get a 0-3 index, then picks per-variant hitbox tables.

### 5.1 The shared init -- variant-byte dispatch

Bank02.asm:3153-3184 `init_falling_rock_common`:

```
$029E55 init_falling_rock_common:
    LDA !EXRAM_YI_Level_NorSpr_SpriteID,x
    SEC
    SBC #!Define_YI_NorSpr137_3x6FallingStone
    ASL                                           ; * 2 (word-table index)
    TAY                                           ; Y = variant index {0,2,4,6}
    LDA $70E2,x
    CLC
    ADC DATA_029E35,y                             ; per-variant X offset
    STA $70E2,x
    LDA $7182,x
    CLC
    ADC DATA_029E3D,y                             ; per-variant Y offset
    STA $7182,x
    LDA DATA_029E45,y                             ; per-variant X hitbox
    STA $76,x
    LSR
    STA $7BB6,x                                   ; X half-width
    LDA DATA_029E4D,y                             ; per-variant Y hitbox
    STA $78,x
    LSR
    INC
    STA $7BB8,x                                   ; Y half-width+1
    LDA #$0008
    STA $7B56,x
    STA $7B58,x
    RTL
```

The four 4-entry tables:

| Table | Address | Contents | Role |
|-------|---------|----------|------|
| `DATA_029E35` | Bank02:3137 | `$0000,$0000,$0000,$0008` | Per-variant X anchor offset (only the 6x3 wide slab shifts +$08) |
| `DATA_029E3D` | Bank02:3140 | `$FFD8,$FFF0,$FFC0,$FFF0` | Per-variant Y anchor offset (the 3x9 column anchors higher) |
| `DATA_029E45` | Bank02:3143 | `$0030,$0030,$0030,$0060` | Per-variant X hitbox width (only the 6x3 is wider) |
| `DATA_029E4D` | Bank02:3146 | `$0060,$0030,$0090,$0030` | Per-variant Y hitbox height (3x6 / 3x3 / 3x9 / 6x3) |

The hitbox encoding is `$30` = 3 tiles, `$60` = 6 tiles, `$90`
= 9 tiles. So $137 is 3 wide x 6 tall, $138 is 3x3, $139 is 3x9,
$13A is 6x3.

The five WRAM writes at the end (`$76,x`, `$78,x`, `$7BB6,x`,
`$7BB8,x`, `$7B56-$7B58,x`) install both the **dispatch hitbox**
($76/$78 for state machine, $7BB6/$7BB8 for collision) and the
**center-anchor box** ($7B56/$7B58 = $0008 each).

### 5.2 The shared main -- floor probe + crush + crumble

Bank02.asm:3188 `YI_NorSpr137_3x6FallingStone_Main:` (also entry
for $138/$139/$13A):

The body splits on `$18,x`:

- `$18,x = 0` (mid-drop): `CODE_029E99` (Bank02.asm:3198). Run
  gravity tick via `CODE_03AF23`; probe Map16 cell at
  `($7CD7+$00, $7CD8-$02)` via SuperFX `FXCODE_0ACE2F`; if the
  cell is a solid floor (high bit clear), snap to it, zero
  Y-speed, play `SoundID48_LargeBlockLands`, set `$61C6 = $0020`
  (screen-shake), advance to `$18,x = 1` (crumble).
- `$18,x = 1` (crumbling): `CODE_029F33`. Calls
  `CODE_change_map16` to stamp the falling-stone Map16 tiles
  into the BG1 layer (using the data tables at `DATA_029DCA`
  -- a 22-entry table of Map16 tile IDs for the stomp-shape).
  Increments `$7A38,x` (crumble-frame counter); when it reaches
  the per-variant tile-count from
  `!EXRAM_YI_Level_NorSpr_GenericTable7019D8,x`, deallocates
  the sprite slot.

The crush damage delivery is handled by the floor-probe step --
when the stone snaps to floor, if Yoshi's hitbox is between
$00-$00FF + $0018 of the stone in X and $0018 in Y, the engine
auto-routes Yoshi to `PlayerState12_SmushedByWall` (line 3070
of `CODE_029D97` -> `CODE_03A31E`). The same path is the wall-
crush path used by the Falling Wall ($036).

### 5.3 The shared SuperFX render helper

`CODE_029DF6` (Bank02.asm:3104) is shared by both the falling
stones and the falling rock platform ($0DE). It batches the
sprite slot's coordinates + hitbox into `!REGISTER_SuperFX_R1`
through `R6`, dispatches `FXCODE_099126`, and returns the
SuperFX-side stamp-coords for the per-tile draw. The same SuperFX
helper is invoked by Falling Rock Platform's Main too -- see
§6.2.

---

## 6. Falling rocks + other drops ($036 Wall, $0DE Rock Platform, $190 Icicle)

Three sprites that all share "thing falls on Yoshi", but with
three different damage models, three different rendering pipes,
and three different per-state machines. They don't share Init
or Main bodies the way the falling stones $137-$13A do.

### 6.1 Falling Wall ($036) -- BG3 layer + HDMA-driven drop

The crumbling castle wall. The defining feature is that the
**wall is rendered on BG3**, not as a normal sprite OAM cluster
-- the level loader pre-allocates a BG3 tilemap region for it,
and the sprite's Main writes scroll deltas + a Mode-7 sine LUT
to drive the wall's drop animation.

Bank02.asm:162 `init_falling_wall` does five things:

1. **Tileset-conditional palette tweak.** If level header
   `BG1Tileset = $0A` (dark castle), set bit 2 of `$7042,x`
   (the OAM palette-mod bit) so the wall draws in the dark
   palette.
2. **Re-entry guard.** Call `CODE_028183` (Bank02.asm:205) --
   if `$0CB2 != 0`, abort the spawn (the wall is already
   active in another slot).
3. **Position tweak.** Add `DATA_028129[$0073]` to X-position;
   `$0073` is the screen-quadrant indicator so the wall can
   spawn on either side of the player.
4. **HDMA + scroll setup.** `$0CB8 = $0104` (HDMA-active flag),
   `$7E40 = 0` (current scroll offset), `$0CB4 = 0` (drop-state
   sub-byte).
5. **Palette pool load.** Copy 36 bytes from
   `DATA_falling_wall_palette_pool` (`$0280BD`, the 108-byte
   per-variant palette table at Bank02.asm:144) to
   `$70404A` (the per-sprite CGRAM mirror). Indexed by
   `($7042 AND #$E)` -> one of four 27-byte palette slabs.

The 108-byte palette pool is split into **four palettes** (BGR
triples, one byte each = 36 bytes per palette, 3 palettes used):
unique per-variant tints (e.g., gray-stone vs dark-castle vs
neutral). The four sets share their last 9 bytes for the
common gray-block colors.

Main (Bank02.asm:248) `main_falling_wall`:

- Calls `CODE_02841A` (top-of-frame setup, sets BG mode bits).
- Calls `CODE_03AF23` for gravity.
- Sub-state `$7A96,x`: if 0, idle until Yoshi enters the
  drop-trigger box (`$7C16+$30 < $61` AND `$7C18+$30 < $61` AND
  player state is Normal); on trigger, set `$0CB4 = 1` (drop
  phase 1).
- Drop phase 1: `DATA_0281FC[0]` = `$FC00` X-accel, `DATA_028200[0]`
  = `$0000` Y-accel; rotate the wall via `FXDATA_0BBA12` sine
  LUT (Mode-7 matrix-A register). When the wall has rotated past
  $40 degrees, transition to phase 2.
- Drop phase 2: `DATA_0281FC[1]` = `$04FF` X-accel,
  `DATA_028200[1]` = `$00F0` Y-target. Player-state check at
  Bank02.asm:374 -- if Yoshi is at `PlayerState12_SmushedByWall`,
  the wall stays in slot until the smush-death animation
  completes.
- Drop phase 3 (impact): Play `SoundID47_Explosion`,
  `$61C6 = $0060` (heavy screen-shake), `$0CB4 = 3` (post-impact
  hold), then re-init the Falling Wall slot.
- Bank02.asm:466 sets `PlayerState12_SmushedByWall` if Yoshi's
  X falls within the wall's hitbox during the drop -- this is
  the **kill verb** for the wall.

### 6.2 Falling Rock Platform ($0DE) -- shared with falling stones

Bank02.asm:2940 `init_falling_rock`. Calls the same SuperFX
helper `FXCODE_0ACD1E` to **probe the floor below the spawn
point** -- the helper returns the floor's Map16 cell + the
distance to it. If the probe returns 0 (no floor), the spawn
aborts via `JML CODE_03A31E` (engine "spawn rejected" branch).

If the probe succeeds:
- `$76,x = !REGISTER_SuperFX_R9` (the floor's X-extent in tiles).
- `$78,x = !REGISTER_SuperFX_R10` (the floor's Y-extent).
- `$7BB6,x = $76 >> 1` (X half-width).
- `$7BB8,x = ($78 >> 1) + 1` (Y half-width + 1, the asymmetric
  one).
- `$7A96,x = $0070` (the 112-frame "wait for Yoshi" drop timer).

Main (Bank02.asm:2987) is **the same body that runs falling
stones $137-$13A** -- the label `main_falling_rock_common`
covers both. The dispatch on `$18,x` distinguishes "drop"
(state 0) from "crumble" (state 1). The only behavioral
difference is the variant hitbox set by Init -- the rock
platform's hitbox is the **probed floor extent**, not a
fixed table-lookup like the falling stones.

The damage payload is the **crush** -- when the rock platform
lands and Yoshi is between $7019D6 (X-extent low) and $7019D8
(Y-extent low), the engine routes to `PlayerState12_SmushedByWall`
(Bank02.asm:319 / 466 + Bank04's player-state dispatch).

Notable detail: Bank02.asm:3036-3071 has a **pre-drop Yoshi-
position bias** -- when the timer reaches the `$0050` mark
(80 frames left), the rock can shift its X-position to **track
Yoshi** (the `LDA $14 LSR BCC` is the 50%-of-frames gate; on hit
the rock's `$72C0,x` X-velocity gets a one-step nudge toward
Yoshi). So the rock platform's drop *does* slowly home in on
the player during the wait-period -- it's not pure falling.

### 6.3 Falling Icicle ($190) -- 4-state hang/wobble/fall/shatter

Bank0C.asm:88 `init_falling_icicle` is minimal: zero Y-speed,
set `$74A2,x = $FFFF` (the "pre-fall" marker). The icicle hangs
from a ceiling cell.

Main (Bank0C.asm:106) walks the 4-entry state table
`DATA_falling_icicle_state_ptr` (`$0C8031`):

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0C8039` (Bank0C.asm:128) | **Hang.** Run SuperFX `CODE_0C80E4` to probe the ceiling Map16 cell (via `FXCODE_0ACE2F`). If `$7CD6 - $611C + $60 < $C0` (Yoshi is in the X window) AND `$7CD8 - $611E - $20 < 0` (Yoshi is below), seed `$18,x = $0030` (wobble timer) and advance to `$16,x = 2`. |
| `$02` | `CODE_0C8065` (Bank0C.asm:151) | **Wobble.** Probe wall via `CODE_0C8133` (Bank0C.asm:234 -- the "did the icicle's neighbour tiles deny it room to drop" check); play `SoundID59_RollingRock`; copy pose to `$76,x`; advance to state $04. |
| `$04` | `CODE_0C80AD` (Bank0C.asm:168) | **Fall.** Apply gravity; the 24-entry `DATA_0C807B` (`$0000,$FFFF,$0001,$0001,...$FFFF`) is a wobble-offset table walked per-frame to add a left/right "shake" to the dropping icicle. On floor-touch (`$7A96 = 0`), play `$7542 = $0040` (sound cue) and advance to state $06. |
| `$06` | `CODE_0C80DB` (Bank0C.asm:193) | **Shatter.** Render the shattering ice via `CODE_0C82B4` (Bank0C.asm:300) -- this writes a 4-tile shatter splat directly into the Map16 cells, deletes the sprite slot. |

The SuperFX probe at `CODE_0C80E4` (Bank0C.asm:199) is unique to
the icicle: it stamps the **ceiling above** via `FXCODE_0ACE2F`
and compares the returned `R6` to `$8E00`/`$8E01`/`$8E02` -- the
"is the ceiling actually a ceiling I can hang from" check.
Returns `JML despawn_sprite_free_slot` if the ceiling tile is
non-anchorable.

`CODE_0C8133` (Bank0C.asm:234) does an extended ceiling probe
that handles **the icicle being 2-3 tiles tall** -- it walks 1
tile up at a time and re-stamps Map16 cells, so when the icicle
falls, the appropriate cells get stamped with the per-pose
shatter tiles (`DATA_0C811B / DATA_0C8123 / DATA_0C812B` -- the
3 possible 4-tile shatter patterns).

The kill verb is **Yoshi-collision while in flight (state $04)**:
the falling icicle's hitbox is `$7BB8` (Y half-width) wide via the
shared engine sprite-vs-Yoshi check; on collision Yoshi takes
the standard "spiky-thing" damage payload routing to
`PlayerState0E_TouchedSpike`.

---

## 7. Snow / ice sub-family ($0DC Snowball)

A single sprite. The Snowball is a rolling/growing projectile
that grows as it rolls and plays the rolling-rock sound.

Bank0E.asm:9376 `init_snowball`:

```
$0EC8D7 init_snowball:
    JSL CODE_03AEEB                               ; engine init shared with projectiles
    LDY !RAM_YI_Level_CurrentLevelFromMapLo
    CPY #!Define_YI_LevelID_RideTheSkiLifts        ; W5 ski-lift level only?
    BNE skip
    LDA #$8001
    STA $7040,x                                   ; <-- bounce-on-floor flag
skip:
    JSR CODE_0EC924                               ; SuperFX render setup (Y-table $548000+$6080)
    LDA #$0598                                    ; <-- initial size = 1432 (sub-pixel)
    STA $7A36,x
    RTL
```

The level-ID check is significant -- on `RideTheSkiLifts`
(World 5-1), the snowball gets `$7040 = $8001` which enables
**bounce-on-floor** behavior (the icy floor causes the snowball
to bounce). On other levels (any other snow level), the snowball
rolls without bouncing.

`$7A36,x` is the **size accumulator**: starts at `$0598`, grows
as the snowball rolls (see Main for the growth math). The
SuperFX render at `CODE_0EC924` uses `R6 = $7A36 >> 3` -- i.e.,
the render-tile-count is the size divided by 8.

Main (Bank0E.asm:9396) `main_snowball`:

```
$0EC8F2 main_snowball:
    JSL CODE_03AB1C                               ; physics: apply X-speed + screen-edge despawn
    JSL CODE_03AF23                               ; gravity
    STZ $7400,x                                   ; clear facing-flag (snowball has no facing)
    JSL CODE_0EC365                               ; <-- growth + ground-collision check
    JSR CODE_0EBFBB                               ; bounce check (uses $7040 bounce flag from init)
    JSR CODE_0EC71A                               ; render + freeze
    JSR CODE_0EC914                               ; per-frame SuperFX dispatch
    JSR CODE_0EC924                               ; SuperFX Y-table setup
    JSR CODE_0EC8A3                               ; sound (RollingRock per-N frames)
    JSR CODE_0EC8C4                               ; despawn-if-off-screen
    RTL
```

The growth step in `CODE_0EC365` (Bank0E.asm:9302 vicinity)
adds to `$7A36,x` proportionally to the snowball's per-frame
X-distance; on each $20-pixel rolled-distance the SuperFX render
tile-count goes up by 1.

Yoshi-contact behavior: the snowball delivers **bump damage** via
the standard sprite-vs-Yoshi collision -- no special Player-state
routing; Yoshi takes a hit and the snowball continues rolling.
The snowball does NOT despawn on Yoshi-hit; it just keeps
rolling until it falls off the level's bottom.

---

## 8. Damage delivery

Hazards in this family deliver damage via four distinct paths:

| Hazard | Player-state on hit | Mechanism |
|--------|--------------------|-----------|
| `$080` Straight Lava Bubble | `PlayerState28_TouchedLava` | Touch the burning bubble = lava-burn-arc death (rising arc + lose-Baby-Mario). |
| `$081` Following Lava Bubble | `PlayerState28_TouchedLava` | Same as straight. |
| `$1AA` Hot Lips | `PlayerState28_TouchedLava` | Same lava-burn path; the rising-lips motion delivers the burn. |
| `$000` Lava Log | n/a (pure platform) | Yoshi rides; no damage. Falling off into lava is a floor-tile event (lava floor = `PlayerState28_TouchedLava`). |
| `$01B` Vertical Lava Log | n/a (pure platform) | Same as $000. |
| `$12F` Horizontal Lava Drop | `PlayerState28_TouchedLava` | Standard lava-burn-arc. |
| `$130` Vertical Lava Drop | `PlayerState28_TouchedLava` | Same. |
| `$137-$13A` Falling Stones | `PlayerState12_SmushedByWall` | Crush -- Yoshi between stone and floor on impact. |
| `$0DE` Falling Rock Platform | `PlayerState12_SmushedByWall` | Same crush as falling stones. |
| `$036` Falling Wall | `PlayerState12_SmushedByWall` | Crush -- against the impacting wall, mid-arc. |
| `$190` Falling Icicle | `PlayerState0E_TouchedSpike` | Spike-bounce -- treated as spiky-thing collision while in state $04 (falling). |
| `$0DC` Snowball | None (standard bump damage) | Sprite-vs-Yoshi collision; Yoshi takes a hit but no Player-state change. |

Three observations:

1. **Lava bubbles share the lava-touch state, not a sprite-specific
   state.** The state $28 path is shared with the level's lava
   floor tiles -- so a bubble-touched Yoshi and a lava-floor-
   touched Yoshi run the same rising-arc death animation. The
   sprite's job is just to detect Yoshi's hitbox proximity; the
   damage routing happens engine-side.
2. **Crush damage is bidirectional.** The falling stone family
   reads the floor below; the falling wall reads the wall
   advancing toward Yoshi. Both end up at state $12 -- the
   single "smushed against a surface" death sequence -- and
   the engine doesn't distinguish "smushed by a wall" from
   "smushed by a ceiling".
3. **The Snowball is the only family member that doesn't kill on
   contact.** It just hits Yoshi (lose-egg + brief stun) and
   keeps rolling. This is the "this enemy is a damager not a
   killer" pattern shared with the Bandit (which steals but
   doesn't kill).

---

## 9. Shared infrastructure

### 9.1 Lava-tileset detection pattern

Three hazards (`$01B`, `$1AA`, and Falling Wall partially
through `$0A`) gate their behavior on the level header's BG1
tileset byte. The relevant tilesets:

| Tileset | Name | Used by hazards |
|---------|------|-----------------|
| `$03` | Lava (primary) | `$01B` widens collision; `$1AA` re-anchors spawn-Y |
| `$0A` | Dark castle | `$036` Falling Wall uses dark palette |
| `$0D` | Lava (variant) | `$01B` widens collision |

The level-header byte lives at `!RAM_YI_Level_LevelHeaderBG1TilesetLo`
and is populated during level load. The pattern is always:

```
LDY !RAM_YI_Level_LevelHeaderBG1TilesetLo
CPY #$03
BEQ lava_path
CPY #$0D
BNE non_lava_path
lava_path:
    ; adjust collision, anchor, palette, etc.
```

### 9.2 The shared SuperFX render helper

`CODE_029DF6` (Bank02.asm:3104) is shared by all four falling
stones + the falling rock platform. It dispatches `FXCODE_099126`
with the sprite's `$7180,x` (pose) and `$76,x / $78,x` (hitbox)
in `R3-R5`. The output goes to OAM via the standard SuperFX
render pipeline.

The falling icicle uses a different SuperFX helper
(`FXCODE_0ACE2F`) for tile-probe AND a 4-tile shatter writer
that bypasses OAM and writes directly to BG1 Map16 -- see
Bank0C.asm:300 `CODE_0C82B4`. The icicle is the only family
member that writes BG1 Map16 cells on impact.

The lava bubbles + Hot Lips share an embedded-sprite-list
SuperFX pattern: each Main loads a sprite-list pointer
(`DATA_0CB944` for Hot Lips, the bubble's own pre-baked OAM
pattern for the bubbles) and a per-tile offset table into
`R3 / R5`, then dispatches `FXCODE_089822` (Hot Lips) or
`FXCODE_0882FA` (straight bubble) for the per-tile blit.

### 9.3 Ambient splash sprites

The hazard family spawns three different ambient splash sprites
at impact / surface-cross moments:

| Sprite | Used by | Visual |
|--------|---------|--------|
| `$1D6` AmbSpr1D6 | Lava bubbles ($080/$081) at Y-step crossings + on splash | 3-stage flicker (DATA_00914E + 6/4/2 hold) |
| `$1FA` AmbSpr1FA | Horizontal Lava Drop ($12F) at endpoints | "Mini-slime generator start" -- stride-6 timer (CODE_009576), 6-frame OAM walk |
| `$1FB` AmbSpr1FB | Vertical Lava Drop ($130) at endpoints | "Mini-slime generator end" -- same body as $1FA |
| `$21B` AmbSpr21B | Hot Lips ($1AA) at inhale ticks | 2-frame countdown OAM walk |

All four ambient sprites are spawned via the engine's shared
`CODE_spawn_ambient_sprite` helper; the call site passes the
sprite ID in `A`, the helper returns the new slot's index in
`Y`. The hazard then sets `$70A2,y / $7142,y / $7782,y` (position,
priority) directly.

### 9.4 Floor / ceiling probe via SuperFX

Two hazards use the SuperFX to probe Map16 cells before
committing to a behavior:

- **Falling Rock Platform** ($0DE) calls `FXCODE_0ACD1E` at
  spawn to probe the floor below the spawn-Y. If no floor,
  the spawn aborts. Returns the floor's X/Y extents which
  become the rock's hitbox.
- **Falling Icicle** ($190) calls `FXCODE_0ACE2F` from
  `CODE_0C80E4` to probe the ceiling above. Returns the
  ceiling tile's type; if not anchorable, the icicle
  despawns immediately.

Both probes use the convention `R1 = X, R2 = Y` for input and
`R6 = tile-type, R9 / R10 = extents` for output. See
`docs/mchip.md` for the SuperFX probe interface.

---

## 10. Cross-references

- `docs/spritestateengine.md` -- per-sprite Main runs from the
  `$10` (active) engine-state slot. None of the hazards in this
  family install custom RideYoshiRt / StompRt -- they all fall
  through to the engine's common stubs in `Bank03.asm`.
- `docs/bossengine.md` -- §4 covers Blargg ($194), the lava
  mini-boss whose submerge / leap / submerge rhythm is a scaled
  Lava Bubble; the full state machine + dyntile pipeline is in
  the boss family.
- `docs/family-platforms.md` -- the parallel "stand-on-this"
  family. Lava Log ($000) sits on the boundary -- Yoshi can
  ride it (platform-like), but its motion model bobs entirely
  on the lava-surface anchor and it has no facing-direction or
  switch-toggle. Cross-referenced from the platform family's
  §0 boundary discussion.
- `docs/leveldataengine.md` -- the level-header tileset bytes
  ($03 lava, $0A dark castle, $0D lava variant) are the gates
  for half this family's variant behavior.
- `docs/mchip.md` -- the SuperFX probe helpers FXCODE_0ACD1E,
  FXCODE_0ACE2F, FXCODE_099126, FXCODE_089822, FXCODE_0882FA,
  FXCODE_0B9567 used by the rendering / collision paths.
- `yi/Constants/AmbientSpriteIDs.asm` -- the four splash
  ambients ($1D6, $1FA, $1FB, $21B) spawned by hazards on
  impact.
- `yi/Constants/PlayerStates.asm` -- the three damage-state
  destinations: $0E (spike), $12 (smushed), $28 (lava).
- See also: `ys_lava*.asm`, `ys_rock*.asm`, `ys_stone*.asm`,
  `ys_fall*.asm`, `ys_ice*.asm`, `ys_snow*.asm`,
  `ys_enmy*.asm`.

---

## 11. Open questions

1. **Lava Bubble launch-randomisation seed source.** The arcing
   bubble ($081) reads `$10` (frame counter) to index into
   `DATA_058E37`. The frame counter is engine-global, not
   per-slot, so two bubbles spawned on the same frame in the
   same level should *always* launch in the same direction.
   In-game observation suggests they don't -- two adjacent
   arcing bubbles tend to fire offset. Need to verify whether
   the `AND #$0006` mask + the per-bubble `$77C2` (facing-
   reference) sufficiently breaks the symmetry, or if there's
   another randomisation hook I'm missing.

2. **Falling Rock Platform Yoshi-bias mechanic.** The pre-drop
   X-bias at Bank02.asm:3036-3071 reads `$14 LSR BCC` as a
   50%-of-frames gate, but the body that follows only runs if
   the **rock is already past the wait-timer's $50 mark**. So
   the rock's "homing-in on Yoshi" can only happen during the
   last 80 frames of the wait. Need to verify whether this
   actually produces visible homing in-game -- if Yoshi can
   run out of the rock's X-window before the wait ends, the
   homing never triggers.

3. **Falling Icicle 2-3 tile variant detection.** `CODE_0C8133`
   probes ceiling-1 and ceiling-2 tiles, branching to the
   3-tile shatter (`DATA_0C812B`) on $8E02, 2-tile
   (`DATA_0C8123`) on $8E01, or 1-tile (`DATA_0C811B`) on
   $8E00. Where does the level loader actually distinguish
   these icicle variants? The icicle's spawn data only carries
   sprite ID $190 -- the height comes from the level's Map16
   layout. Cross-reference with `docs/leveldataengine.md` to
   verify the loader writes the ceiling cells correctly for
   each level's icicle placements.

4. **Snowball-bounce on Ride-The-Ski-Lifts.** The level-ID
   check `CPY #!Define_YI_LevelID_RideTheSkiLifts` is
   hard-coded to a single level. The game has multiple ice/snow
   levels (World 5-3 Sluggy, World 5-4 etc.); do any other
   levels spawn the snowball, and if so, does the no-bounce
   variant make sense visually on those levels? Or is this a
   single-purpose check that exists because that one level had
   a specific design need?

5. **Hot Lips inhale Y-target.** The "lift up 4 pixels above
   `$7A38,x`" line at Bank0C.asm:7751 is hard-coded; the
   inhale state $02 always lifts the lips by exactly 4 pixels
   regardless of Yoshi's altitude. Should it scale with the
   level's gravity or with Yoshi's vertical distance? The
   current behavior means the lips' physical reach is fixed --
   Yoshi can stand 5 pixels above the lava surface and never
   be touched. Verify against in-game observation.

