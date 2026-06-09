# YI miscellaneous small-family reference

A growing-over-time catalogue of small YI sprite families that don't
individually justify a standalone `docs/family-*.md` file. Each top-level
section is self-contained and structured the same way as the larger
family docs: ID table, per-sprite state machines, shared infrastructure,
open questions. Future small families (typically 3-6 sprites with one
shared dispatcher) get appended as new top-level sections here rather
than spawning a new file.

Sections currently here:

- §1 **Door family** ($001 / $012 / $04E / $093 / $0CA / $131)
- §2 **Watermelon family** ($005 / $007 / $009 / $018 / $006)
- §3 **Crazee Dayzee** ($181) -- single-sprite section, kept here
  because Crazee Dayzee is too small to warrant its own file but the
  3-state walking-flower behaviour and head-bop dance reaction are
  worth a focused write-up.
- §4 **Little Mouser family** ($02F / $030 / $032 / $033 / $1A3)
- §5 **Toady family** ($058 / $05C / $091)
- §6 **Grinder / Monkey family** ($1A5 / $1A6 / $1A7 / $1A8 / $1A9)
- §7 **Bat family** ($13D Dangling / $13E Flying)
- §8 **Pinball flippers** ($13C Down / $144 L+R)
- §9 **POW / Switches** ($097 POW Block / $09D Red POW Switch)
- §10 **Crates** ($003 CrateWithKey / $10E CrateWith6Stars)
- §11 **Springs / Balls** ($06C Large / $06F Regular / $148 Large alt)
- §12 **Eggo-Dil cluster** ($0EE Body / $0EF Face / $0F0 Petal)
- §13 **Insects + small fauna** ($152 Flutter / $182 Dragonfly / $183 Butterfly / $191 Sparrow)
- §14 **Oddballs** (one-paragraph entries -- Fuzzy / Fuzzy Fart / Fly Guy / Flower Pot / Soft Block / Spooky / Firebars / Keyhole Cork / Rotating Mace / Chomp Rock / Barney Bubble / Watermelon Seed / Burt the Bashful)
- §15 **Open questions / unclarities**

Future sections append at the bottom; section numbers are stable.

The larger family files are:

- `docs/family-bandits.md`, `docs/family-shyguys.md`, `docs/family-clouds.md`,
  `docs/family-bowserfight.md`, `docs/family-goonies.md`,
  `docs/family-bumpties.md`, `docs/family-taptaps.md`, `docs/family-boos.md`.
- Engine sides: `docs/spritestateengine.md` (the 9-state engine layered
  underneath every entry here), `docs/leveldataengine.md` (how each of
  these sprites is spawned out of level data).

Source of truth: framework asm only. Specifically:

- Doors -- `yi/Banks/Bank02.asm` lines 3464-3984. Shared with
  `yi/Banks/Bank03.asm:9665` (`CODE_pop_door` -- the cloud-spawned door)
  and `yi/Banks/Bank0F.asm:2602` (`$161 RewardItemForDefeatingRoomEnemies`
  variant payload).
- Watermelons -- `yi/Banks/Bank04.asm` lines 60-722.  Companion code in
  `yi/Banks/Bank03.asm:9679` (`CODE_pop_watermelon` cloud spawner),
  `yi/Banks/Bank02.asm:5085` (Monkey-with-Watermelon spitter),
  `yi/Banks/Bank07.asm` BVZ payload-13 ($17B-$17D).
- Crazee Dayzee -- `yi/Banks/Bank0F.asm` lines 453-822 (single self-
  contained block including init, main, the 3 state handlers, helpers,
  and the head-bop response).
- Little Mouser family -- `yi/Banks/Bank0C.asm` lines 4332-7076.
  Five contiguous routine clusters: $02F nest stub (4332-4391), $032
  peeking emerge state machine (4393-4626), $030 free-roaming mouse
  (4633-6820), $033 exit-nest choreography (5498-6705), shared
  helpers including the egg-pickup FXCODE_098EBF gate (6706-6820),
  and $1A3 Little Skull Mouser (6824-7076).
- Toady family -- `yi/Banks/Bank0E.asm` lines 11656-12321 (the
  6-state shared `main_toadies` for $058/$05C plus 6 state-handler
  pointers). $091 4-Red-Toadies lives in `yi/Banks/Bank04.asm`
  10887-11206 (the ambush quartet uses its own RAM block at
  $0E2D..$0EC9 + standalone 5-state `main_four_red_toadies`).
- Grinder / Monkey family -- `yi/Banks/Bank02.asm` lines 4998-6700.
  Five variant Inits at 5027-5163 (each setting a per-variant
  $701900 selector byte via shared `CODE_02AE77`), one common Main
  at 5245-5364, two 6-entry dispatch pointer tables at
  5367-5384, plus shared sub-handlers (death-pose, lunge, terrain
  probe, watermelon spit) through 6700.

Cross-verified against `yoshisisland-disassembly/disassembly/bank02.asm`
+ `bank04.asm` + `bank0F.asm` (Raidenthequick descriptive labels:
`init_closed_door`, `init_locked_door`, `init_boss_door_bowser`,
`main_door`, `init_melon`, `main_melon`, `init_chill`, `main_chill`,
`init_melon_flame`, `main_melon_flame`, `init_crazee_dayzee`,
`main_crazee_dayzee`, `head_bop_crazee_daisy`) and `ys_enmy*.asm` for
the family taxonomy of the small-family enemies.

---

## 1. Door family ($001 / $012 / $04E / $093 / $0CA / $131)

Six sprite IDs share a single `main_door` body and a single co-located
cluster of variant-aware Init handlers, all at `Bank02:3464-3984`. The
core mechanic: detect Yoshi standing in front of the door, run an
open-animation state machine, fade the screen, and transition Yoshi
into `PlayerState0A_EnteringDoor` which kicks off the screen-exit
routing through GameMode $0B.

The Big Boss Door $0CA is the most divergent member -- it has its own
double-wide SuperFX tilemap render (16-row vs the standard 8-row),
and after passing through it the level routes to Bowser's chamber
rather than to a generic exit destination.

### 1.1 ID table

| ID | Constant name | Init handler | Main handler | Tilemap | Role |
|---|---|---|---|---|---|
| `$001` | `ClosedDoor` | `init_closed_door` Bank02:3513 | `main_door` Bank02:3757 | `FXDATA_550000+$0021` | Pre-opened door that game-mode $0D (return-from-bonus-room) snaps Yoshi to. 8-tile tilemap. |
| `$012` | `BossDoor` | `CODE_init_door` (shared) Bank02:3539 | shared `main_door` | `FXDATA_550000+$60C0` | Standard boss-room entrance. Same tilemap as Big Boss Door but no double-width FX. |
| `$04E` | `LockedDoor` | `init_locked_door` Bank02:3487 | shared `main_door` | `FXDATA_550000+$6000` | Requires `$027 Key`. On Init: if key already used (flag in `CODE_03D3F8`) morphs to $001; else falls through. |
| `$093` | `Door` | `CODE_init_door` (shared) Bank02:3540 | shared `main_door` | `FXDATA_540000+$00F1` | Plain room-to-room door. No key, no boss. The default winged-cloud drop. |
| `$0CA` | `BigBossDoor` | `init_boss_door_bowser` Bank02:3471 | shared `main_door` | `FXDATA_550000+$60C0` + secondary `FXCODE_09F897` | Final-boss / Bowser entrance. 16-tile double-height tilemap. Distinct hitbox `$1C` x `$39`. |
| `$131` | `LockedDoor` (variant 2) | `CODE_init_locked_door_2` Bank02:3500 | shared `main_door` | (key-state-dependent) | Secondary locked-door slot. On Init: if no key collected morphs to $093; if key collected falls into $001's init. Used in levels with multiple lockable doors. |

The base $093 is the most-encountered door in normal level flow. $0CA
appears only in the four boss-fight stages of each world (Bigger Boo,
Salvo, Burt etc.) and the final Bowser fight. $001 is rarely directly
authored; it's typically the result of $04E or $131 morphing.

### 1.2 Shared `init_door` / `main_door` state machine

All variant inits funnel into a common middle (`CODE_init_door` at
Bank02:3541) which sets up:

- 12-pixel-tall, 25-pixel-wide hitbox (`$7BB6=$0C`, `$7BB8=$19`) except
  $0CA which writes `$1C`/`$39`.
- Y-snap to the floor tile beneath the spawn point (16-pixel pull-up
  via `CODE_02A1FD` -> `CODE_03AE60`).
- Initial state `$18,x = 0` (closed, idle) unless `$001` Init was
  reached -- $001 sets `$18,x = 2` (closing, the return-from-bonus-room
  case) and primes a 64-frame open-then-close animation.
- SuperFX render of the door tilemap via `CODE_02A153` (variant-aware:
  selects one of five `FXDATA_540000+...` / `FXDATA_550000+...` source
  pointers and submits FXCODE_08D317; $0CA additionally submits
  FXCODE_09F897 for the second-half tilemap).

The shared `main_door` (Bank02:3757) dispatches on the high-level
state byte at `$18,x`:

| `$18,x` | State | Handler entry | Behaviour |
|---|---|---|---|
| `$00` | **Closed / idle.** | `CODE_02A33B` | Re-render tilemap each frame. Watch for Yoshi-overlap (Y matches, X within hitbox, up D-pad held bit `$0038 & $08`, Yoshi alive `$61B2 < 0`, no other freeze `$6150 == 0`). On valid overlap: if door is locked and Yoshi is carrying a $027 Key consume the key + play `SoundID64_UnlockDoor` and skip the message; else play `SoundID38_BabyMarioJump` (the "no key" reject). On accept: write `PlayerState0A_EnteringDoor`, freeze Yoshi+sprites, advance `$18,x = 1`. |
| `$01` | **Opening animation.** | `CODE_02A40F` (via `CODE_02A3F0`) | Animate `$76,x` (per-frame angle accumulator) through the 4-quadrant table `DATA_02A320` / `DATA_02A328`. Each quadrant runs $40 frames; on quadrant boundary $7402,x toggles between $0000 and $0001 (flips the second-half tile lookup). At quadrant 3 ($78,x = 6) play `SoundID40_OpenDoor`. After full $20 ticks ($78,x >= $08), play `SoundID41_CloseDoor` and either: (form != 0) zero everything to skip the cutscene; (locked-door) DEC `$6104` to mark "used key"; (regular) start GameMode$0B level-exit flow. |
| `$02` | **Closing animation (return-from-bonus).** | same dispatch path | Animates identically but in reverse direction (`LSR` of $18,x selects which sign-of-rotation block runs at line Bank02:3870). Used only when re-entering a level via $001 ClosedDoor in GameMode$0D. |

Per-slot state held by a door:

| Address | Meaning |
|---|---|
| `$18,x` | High-level state (closed/opening/closing). |
| `$76,x` | Frame accumulator for the spin-open animation. Walks from $00 -> $80 across 4 quadrants of $20 frames each. |
| `$78,x` | Quadrant counter (0..8). $02 triggers Yoshi-X-snap, $06 triggers OpenDoor SFX, $08 triggers exit transition. |
| `$7A36,x` | Locked-door flag (set in $131 init via INC, checked in $00 state to require key). |
| `$7A96,x` | Per-state delay; seeded to $40 on key-unlock, $02 otherwise; counted down before frame advance. |
| `$7402,x` | Render-time tile-lookup index (toggled per quadrant). |
| `$7BB6,x`,`$7BB8,x` | Hitbox half-extents. `$0C`/`$19` standard; `$1C`/`$39` for $0CA Big Boss Door. |

### 1.3 Variant differences

The locked-door logic ($04E, $131) is the most interesting -- both
variants Init by querying `CODE_03D3F8`, the engine's "is the key
flag set" gate that lives in the level header / save state, and
**morph their own sprite-ID** based on the answer:

```
init_locked_door ($04E):
    JSL CODE_03D3F8           ; carry / zero-flag = "have key"
    BEQ no_key_path           ; (Z=1 -> haven't picked it up yet)
    LDA.w #$001                ; key already used -- become a permanent ClosedDoor
    STA EXRAM_SpriteID,x
    ; ...snap to floor...
    BRA YI_NorSpr001_ClosedDoor_Init
```

```
CODE_init_locked_door_2 ($131):
    JSL CODE_03D3F8
    BNE haveKey                ; (Z=0 -> have a key in inventory)
    INC $7A36,x                ; arm "locked" flag
    BRA fall_into_door_init    ; -> CODE_02A134 (render + return)
haveKey:
    LDA.w #$0093               ; become plain door
    STA EXRAM_SpriteID,x
    BRA fall_into_door_init
```

Note the asymmetry: $04E uses `BEQ` (have-key -> become $001), while
$131 uses `BNE` (have-key -> become $093). That's not a bug -- it's
two different *meanings* of the flag depending on which lock is
which:

- $04E is a "permanent" lock on a door that the key sticks into and
  consumes. Once unlocked, it stays unlocked across save, hence
  morphing into $001.
- $131 is a "level-flow" lock: while the player is still carrying
  an unused Key, the door is plain $093 (already openable). The
  $131 lock state only persists if the key has been consumed at
  $04E -- so the inverted check makes sense.

`init_boss_door_bowser` ($0CA) is a simpler divergence:
- Uses the larger hitbox ($1C x $39).
- Renders a 16-row tilemap (`CODE_02A247` is the double-loop SuperFX
  attribute writer, 16 OAM slots vs the standard 8 in `CODE_02A20A`).
- Emits a second FXCODE_09F897 call for the additional graphic.

All five non-$0CA variants run an identical exit transition. The
distinction "Bowser door vs regular boss door vs normal door" is
encoded only in **which level-exit destination** the post-door
GameMode$0B reads from the level header; no flag in the door slot
distinguishes them.

### 1.4 Screen-exit trigger mechanism

The transition from "Yoshi walked into the door" to "screen fades out
and the level engine routes to the destination" is a 4-step handoff:

1. **Main door $00 state** detects overlap and writes to player state:
   ```
   LDA #!Define_YI_PlayerState0A_EnteringDoor
   STA EXRAM_Player_CurrentStateLo
   STZ $0C8C            ; player's facing for the post-door spawn
   STZ $6104            ; locked-door consumption flag (DEC'd later if $04E)
   INC $0C8E            ; "door-active" interlock
   ; freeze Yoshi + sprites:
   STA EXRAM_Level_FreezeYoshiFlagLo
   STA EXRAM_Level_FreezeSpritesFlagLo
   ```

2. **Open animation runs $20 ticks** ($18,x = 1). The door dispatches
   via `CODE_02A40F` and the embedded `DATA_02A320` rotation table
   (Bank02:3746-3750). At quadrant boundary the door snaps Yoshi's X
   to align with the centerline (Bank02:3874-3886).

3. **At quadrant 4 ($78,x = 8)**, the door checks `$6104`. If $04E
   the door first marks the key consumed by entering the locked-door
   record-keeping branch; then for all variants:
   ```
   LDA EXRAM_Player_CurrentFormLo
   BEQ start_exit            ; only if not in Train/Helicopter/etc form
   ; (mid-form: zero $0C8E, $0C8C, sprite-freeze, skip cinematic)
   ```
   Form-zero gives a normal screen-exit. Non-zero form skips the
   cutscene because Yoshi can't enter a door in those forms; the
   cleanup is to back out gracefully.

4. **GameMode$0B** is set (the screen-fade/level-exit gamemode). The
   door has also already written the per-screen exit index based on
   Yoshi's tile coordinates into `$038E` and stamped a
   `SoundID22_EndFuzzyDistortedMusic` to halt music. The level-loader
   reads `$038E` and routes to the appropriate destination -- see
   `docs/levelloader.md` and `docs/leveldataengine.md` for the per-
   screen exit table format.

The `$027 Key` consumption (when the door is $04E and Yoshi is
holding a Key sprite) is a separate sub-step in CODE_02A388
(Bank02:3805): the routine despawns the Key slot (via CODE_03A31E),
plays `SoundID64_UnlockDoor`, and sets the level-permanent flag via
`CODE_03D3EB`. The key sprite was previously bound to Yoshi via
`$7DF6` (the "carrying" link).

### 1.5 Cross-references

- `yi/Banks/Bank02.asm` -- the full door cluster (3464-3984).
- `yi/Banks/Bank03.asm:9665` -- `CODE_pop_door`, the winged-cloud
  $0C2 spawn-a-door handler.  Spawns a $093 in the cloud's slot.
- `yi/Banks/Bank03.asm:9341-9348` -- the `winged_cloud_pop_table`
  entry $26 -> `CODE_pop_door`.
- `yi/Banks/Bank0F.asm:2602` -- `$161 RewardItemForDefeatingRoomEnemies`,
  whose 4-entry `DATA_0F92D9` reward table includes a door variant.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $001 / $012 /
  $04E / $093 / $0CA / $131; $027 Key (the unlock token); $1A4
  KeyholeCork (the alternative key-consumer for fort levels);
  $0BF WingedCloudWithKey, $0C2 WingedCloudWithDoor.
- `docs/family-clouds.md` -- the winged-cloud Door/Key variants
  ($0BF / $0C2) plus the rest of the cloud-pop table.
- `docs/leveldataengine.md` -- how level data routes through the
  per-screen exit pointers that doors trigger.
- `docs/levelloader.md` -- GameMode$0B (post-door) screen-exit
  routing.
- `yoshisisland-disassembly/disassembly/bank02.asm` --
  Raidenthequick descriptive labels:  `init_closed_door`,
  `init_locked_door`, `CODE_init_locked_door_2`,
  `init_boss_door_bowser`, `CODE_init_door`, `main_door`.
- `ys_enmy.asm` / `ys_dor.asm` -- parallel asm for the door family
  ("dor" being the door-routine module). Same six-variant + shared-
  Main structure.

---

## 2. Watermelon family ($005 / $007 / $009 / $018 / $006)

Five sprite IDs that together implement Yoshi's spittable-watermelon
mechanic: three flavours of thrown watermelon (regular/fire/icy), a
flame-puff child sprite spawned by the fire flavour, and a freeze-
chill child sprite spawned by the icy flavour. The three thrown
watermelons share `init_melon` / `main_melon` at Bank04:60-237 and
diverge only on a single per-flavour branch.

The Yoshi-side machinery (the watermelon you eat to start spitting
seeds) is *not* in this family -- it's a level-data sprite ID that
becomes Yoshi's current-form indicator. This family covers only the
**projectile** side: the thing that gets thrown / spat by Yoshi /
the fire+ice secondary effects on impact.

### 2.1 ID table

| ID | Constant name | Init handler | Main handler | Flavour-specific branch | Role |
|---|---|---|---|---|---|
| `$005` | `IcyWatermelon` | `init_melon` Bank04:72 | `main_melon` Bank04:105 | calls `CODE_melon_icy_freeze_tick` (Bank04:230) every frame | Frozen melon. On terrain bounce, plays cool-blue palette. On enemy contact, spawns `$006 WatermelonFreeze` to lock the enemy. |
| `$007` | `Watermelon` | shared `init_melon` | shared `main_melon` | (no branch) | Plain melon. On enemy contact, plays `SoundID1F_HitHead`, kills via shared `CODE_03B25B`, recoils with `YSpeed = $FE00`. |
| `$009` | `FireWatermelon` | shared `init_melon` | shared `main_melon` | (handled by spawn-time per-flavour spawn -- the contact branch picks $018 via DATA_04832D/048335 jitter table) | Fire melon. On enemy contact spawns ambient $213 puff + ignites with `$018 WatermelonFlame` child. |
| `$018` | `WatermelonFlame` | `init_melon_flame` Bank04:514 (RTL) | `main_melon_flame` Bank04:534 | -- (the flame is a child, doesn't have flavour switching) | Fire-trail puff. Lives 4 frames at $7A96-cycled corners; if it overlaps an alive enemy, calls FXCODE_099011 + FXCODE_09906B to apply the burning-status and launches the enemy upward (`YSpeed = $FC00`). |
| `$006` | `WatermelonFreeze` | `init_chill` Bank04:643 (RTL) | `main_chill` Bank04:657 | -- (single behaviour) | Freeze chill overlay. Per-frame SuperFX FXCODE_099011 draws crystals around the target. On overlap with an alive sprite that has the freeze-status, plays `SoundIDA0_FreezeEnemy` + sets freeze-flag + spawns `$1CD` ambient-puff. Self-despawns when $7402,x decrements past zero. |

Three of these are the "thrown" projectiles ($005/$007/$009) and
two are the "on-contact" effect children ($006/$018). The parent->
child handoff is the most interesting mechanic in the family --
see §2.3.

### 2.2 Shared `init_melon` / `main_melon` projectile state machine

All three thrown melons share Init at Bank04:72:

```
init_melon:
    JSL CODE_02A007                ; shared sprite-Init prologue
                                    ;   (calls FXCODE_0ACE2F to query terrain
                                    ;    at sprite-position+8/+16)
    STZ EXRAM_GenericTable701902,x ; clear "has hit terrain" flag
    LDA $70E2,x                     ; pixel X
    CLC : ADC #$0008
    STA REGISTER_R8                 ; FXCODE arg: X+8
    LDA $7182,x                     ; pixel Y
    CLC : ADC #$0010
    STA REGISTER_R0                 ; FXCODE arg: Y+16
    LDX #FXCODE_0ACE2F>>16
    LDA #FXCODE_0ACE2F
    JSL CODE_BeginSuperFXProcessing
    LDX $12
    LDA REGISTER_R7
    AND #$0003                      ; 2 low bits of R7 = terrain-collision flags
    BNE CODE_048066                 ; if hit, immediately fall into bounce setup
    RTL
```

This shared prologue queries the terrain bit-mask via the SuperFX
collision routine (it runs in parallel during the JSL above). On
return: if R7's bottom 2 bits are non-zero, the melon spawned
on/inside a wall and immediately enters the bounce state at
`CODE_048066`. This is rare in normal level data; the prologue
exists to handle "winged cloud popped over a tile" or similar
spawn-clipping cases.

Main at Bank04:105 is then:

| Step | What happens | Where |
|---|---|---|
| Flavour branch | If sprite ID == $005, JSL `CODE_melon_icy_freeze_tick` (each frame increments $7A96 toward 0, then jumps to bank03 `CODE_03B5C3` which spawns a small ambient frost-puff $1F0 in a random direction). Other flavours skip this. | Bank04:111-114 |
| Carry / held check | Check `$7542,x` (carried-by-Yoshi flag) and `$7D36,x` (touch-link). When melon is in Yoshi's mouth ($7542 != 0 and $7D36 negative) it gets parked and re-rendered. | Bank04:116-153 |
| Stomp / contact check | `$7D36,x - 1` -- if the link is to a non-Yoshi alive sprite and that sprite's status is $0010 (alive) and its $7D38 (held-flag) is set, treat as "in-flight kill": run `CODE_03B25B` (the universal sprite-kill routine) on the linked sprite, then drop into the post-kill bounce state. | Bank04:118-128 |
| Bounce-state setup | At `CODE_048066`: set `YSpeed = $FD00` (recoil upward), enable explosion palette via `$6FA0`, mark `$74A2 = $0005` (death animation), set per-state timer `$7542 = $0040`. | Bank04:132-152 |
| Floor-bonk handling | When melon's `$7860 & $0001` (touching floor), call `CODE_03A590` (ricochet helper) then mirror downward Y-speed if > $0200. Stops at $0200 to prevent infinite-bounce. | Bank04:155-170 |
| Held-by-other check | If $18,x links to another sprite slot and that sprite is alive, do AABB overlap (X delta < $20 and Y delta < $38) -- if overlap, both sides clear `$7019D8` and `$701902` then drop into bounce. | Bank04:171-198 |
| Per-flavour kill branch | At `CODE_0480FC`: if `$76,x != 0` and not currently linked to Yoshi, run the kill: play `SoundID1F_HitHead`, set status to `$000E` (dying), set `YSpeed = $FE00`. (This is where $018 / $006 spawns happen by spawn-sprite calls inside the SoundEffect block -- see §2.3.) | Bank04:199-225 |

State held in a thrown melon:

| Address | Meaning |
|---|---|
| `$76,x` | Per-state flag (0 = not-yet-killed, non-zero = pending kill animation). |
| `$18,x` | Slot-link to "held-by" sprite (if non-zero, this melon is carried by another sprite). |
| `$7402,x` | Animation frame (mainly for the explosion/crack sequence). |
| `$7542,x` | Carry-cooldown timer (set to $40 on bounce-setup, decremented elsewhere). |
| `$7A96,x` | Icy-flavour freeze tick countdown (only $005 uses this). |
| `$7019D8,x` (EXRAM) | "Currently held by other" flag (paired with `$18,x` link). |
| `$701902,x` (EXRAM) | Spawn-cleared "has hit something" tag; reset to 0 in Init. |
| `$7D36,x` | Touch link -- which slot's hit caused this contact frame. |

### 2.3 Per-flavor on-contact branch

The most interesting variant-encoding pattern in the family is **how
the contact branch picks which child sprite to spawn**. There's no
explicit "if FireWatermelon spawn $018" branch in `main_melon` --
instead, the contact path uses sprite-ID arithmetic against the
per-flavour secondary table.

For the icy flavour, the spawn happens inside `CODE_melon_icy_freeze_tick`
which calls `CODE_03B5C3` (Bank03:7347):

```
CODE_03B5C3:                          ; spawn AmbSpr1F0 at random nearby position
    JSL CODE_random_number_gen
    LDA $796F : AND #$FF00 : ORA $7BB8,x
    STA REGISTER_Multiplicand
    LDA EXRAM_RNGOutputHi : LSR
    NOP #2 ; multiplier latency
    LDA REGISTER_ProductOrRemainderHi
    AND #$00FF
    BCC .pos : EOR #$FFFF             ; sign by carry
.pos:
    ADC $70E2,x : STA $00              ; X
    ; (same for Y -> $02)
    LDA #!Define_YI_AmbSpr1F0          ; the small frost-puff
    JSL CODE_spawn_ambient_sprite
    ...
```

So the icy melon spawns ambient `$1F0` (a small visual sparkle)
**continuously while in flight**, not just on contact. The actual
freeze-overlay child ($006) is spawned at the moment of impact by
the shared kill path: when $76,x is set and the melon overlaps an
enemy slot, the engine spawns child sprites depending on which
flavour the parent is. The implementation of this spawn lives in
`CODE_03B25B` (the universal sprite-kill routine in Bank03, not the
melon code itself).

For the fire flavour, the in-flight per-frame check in
`main_melon_flame` (Bank04:534, the **child** sprite $018's main):

```
main_melon_flame:
    JSL CODE_03AF23
    REP #$10
    LDA EXRAM_GenericTable701902,x   ; this child's parent-slot index
    TAX                               ; X = parent melon slot
    LDA $700007,x : AND #$00FF
    CMP #$0089                        ; "alive enemy" status marker
    BNE no_target
    LDA $700006,x : AND #$00FF
    ASL : TAY
    LDA $700000,x : AND #$FFF0
    CLC : ADC DATA_04832D,y           ; corner-offset X
    STA $6000
    LDA $700002,x : AND #$FFF0
    CLC : ADC DATA_048335,y           ; corner-offset Y
    STA $6002
    JSL CODE_00E01F                    ; (engine helper)
    SEP #$10
    LDA #!Define_YI_AmbSpr213           ; spawn corner puff
    JSL CODE_spawn_ambient_sprite
    ...
```

The child sprite **inherits its parent's slot index** through
`$701902,x` (a back-pointer), then uses the 4-entry per-corner
offset table at DATA_04832D/048335 to position itself at one of the
four corners of the parent's tile. The four corners are visited in
sequence (controlled by $7402 cycling 0..3) before despawn.

For the icy flavour, the child sprite $006 (`main_chill`) is even
simpler -- it uses `FXCODE_099011` to draw the icy-crystal effect
per frame, and `FXCODE_09906B` to test for sprite intersection:

```
main_chill:
    JSL CODE_03AF23
    LDA $7A96,x : BNE no_anim
    LDA #$0006 : STA $7A96,x
    DEC $7402,x : BPL no_anim
    JML CODE_03A31E                    ; self-despawn after $7402 underflow
no_anim:
    TXA : STA REGISTER_R1               ; FX arg = slot index
    LDX #FXCODE_099011>>16
    LDA #FXCODE_099011                  ; SuperFX crystal renderer
    JSL CODE_BeginSuperFXProcessing
    ...
```

The icy chill child specifically targets sprites whose `$7040 & $0040`
bit is set (the "freezable" flag -- not all enemies have this); on
overlap with such a sprite it sets `$7D96,y = $0200` (the freeze-
timer on the target), zeros the target's X-speed, and applies a
recoil `YSpeed = $FD00`. So the freeze effect is symmetric: the
chill sprite is per-target, but it only freezes targets that are
allowed to be frozen.

The per-flavour "what damage type" is therefore encoded as:
- $007 regular: kill via `CODE_03B25B` (instant kill).
- $009 fire: kill + spawn $018 children that ignite the area (each
  child is itself capable of igniting enemies it touches).
- $005 icy: kill + spawn $006 child that freezes the enemy in place
  (no damage; the enemy is frozen and then can be smashed by Yoshi).

The kill-vs-freeze distinction is the *parent's* responsibility on
contact; the children just visualize and propagate the secondary
status.

### 2.4 SuperFX terrain-query usage

Both Init and Main use `FXCODE_0ACE2F` for terrain testing -- this
is the same routine used by the Key sprite (Bank02:3388) and by
keyhole-bound sprites generally. The R7-mod-4 bit-pattern returned
by 0ACE2F encodes:

- bit 0 set = solid (any wall/floor/ceiling).
- bit 1 set = slope or special-collision tile (lava, conveyor, etc.).

The Main routine's actual collision-vs-bounce decision is split:
- The `JSL CODE_03AF23` early in Main applies engine-level physics
  including standard floor checks (sets `$7860 & $0001` if floor-
  touching).
- The flavour-specific freeze tick (icy only) doesn't query
  terrain itself -- it just calls `CODE_03B5C3` for ambient-puff
  spawn.
- The floor-bonk recoil in Main lines 155-170 reads `$7860 & $0001`
  (set by 03AF23) and inverts Y-speed if downward and > $0200.

So the SuperFX terrain query isn't being repeated each frame in
`main_melon` -- only the engine's physics step does. This matches
the convention in `docs/spritestateengine.md`: state machines layer
on top of the engine's per-frame physics, they don't bypass it.

### 2.5 Cross-references

- `yi/Banks/Bank04.asm` -- the full thrown-watermelon cluster (60-237),
  $018 WatermelonFlame (509-634), $006 WatermelonFreeze (637-722).
- `yi/Banks/Bank03.asm:9685` -- `CODE_pop_watermelon`, the variant-
  aware spawner used by the three winged-cloud melon-clouds. Notable:
  selects the variant via `SpriteID - $0C4` arithmetic into
  `DATA_03C818` (3-entry table of the three thrown-melon IDs).
- `yi/Banks/Bank03.asm:7347` -- `CODE_03B5C3`, the in-flight ambient
  frost-puff spawner used by the icy variant.
- `yi/Banks/Bank02.asm:5085` -- `$1A6 MonkeyWithWatermelon`, the
  level-data spawner that fires Watermelons (`init_grinder_spits_seeds`).
- `yi/Banks/Bank07.asm` -- `$17B BVZ-with-Watermelon`, `$17C
  BVZ-with-FireWatermelon`, `$17D BVZ-with-IcyWatermelon` -- the
  Baron Von Zeppelin payload variants. $17D additionally runs
  `CODE_melon_icy_freeze_tick` while carried for the visual flash.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $005 / $006 /
  $007 / $009 / $018, plus $107 WatermelonSeed (Yoshi's seed
  projectile), $0C4-$0C6 winged-cloud-with-melon variants.
- `docs/family-clouds.md` -- the winged-cloud Watermelon variants
  ($0C4 / $0C5 / $0C6) section.
- `docs/spritestateengine.md` -- 9-state engine dispatcher that runs
  `main_melon` each frame.
- `yoshisisland-disassembly/disassembly/bank04.asm` -- Raidenthequick
  labels `init_melon` / `main_melon` / `init_melon_flame` /
  `main_melon_flame` / `init_chill` / `main_chill`.
- `ys_enmy.asm` family + `ys_chr.asm` -- parallel asm for the
  watermelon projectiles.

---

## 3. Crazee Dayzee family

A single sprite, $181 CrazeeDayzee, but with a well-defined 3-state
walking-flower behaviour and a memorable head-bop dance reaction.
It doesn't share code with any other sprite -- it's a standalone
member of the "small enemy" set. The behaviour is concentrated in
the contiguous block at Bank0F:453-822.

### 3.1 ID table

| ID | Constant name | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$181` | `CrazeeDayzee` | `init_crazee_dayzee` Bank0F:463 | `main_crazee_dayzee` Bank0F:497 | `head_bop_crazee_dayzee` Bank0F:812 | Cheerful flower-headed walker. 3-state walk/pivot/launch-bubble cycle. Spawns a child $019 Bubble on entering state $04. |

There's no level-data wave-spawner or BVZ-carried variant of Crazee
Dayzee. It appears only as a direct sprite-list entry; the family
is single-member.

### 3.2 State machine

`main_crazee_dayzee` dispatches on `$16,x` (state index, half-step
indexed: $00 / $02 / $04 -> 0 / 1 / 2 in the 3-entry pointer table):

```
DATA_0F83C5:
    dw CODE_0F83E3     ; state $00 -- walk / face Yoshi
    dw CODE_0F8487     ; state $02 -- pivot / look at Yoshi
    dw CODE_0F84DB     ; state $04 -- launch bubble (state machine 0F84DB)
```

| `$16,x` | State | Handler | Behaviour |
|---|---|---|---|
| `$00` | **Walk / face-Yoshi.** | `CODE_0F83E3` | Walks via X-velocity from DATA_0F835C (one of two seeded values, either $0200 or $0400). Animation $7402 cycles through the 12-frame `DATA_0F83CB` walk loop with hold times from `DATA_0F83D7`. Every $20 frames `CODE_0F85FC` spawns an `$0212` ambient "happy notes" emote at Y-offset -16. When `$7860 & $000C` (wall-touch) or `$7860 & $0001` (floor-edge) triggers, switches to state $04 (launch). At regular intervals (`$10 & $003F == 0`), pivots to face Yoshi via state $02. |
| `$02` | **Pivot / look-at-Yoshi.** | `CODE_0F8487` | Walks counter-step: rotates `$7400` (facing) via XOR through `DATA_0F847F` (3-entry table $02/$02/$02/$00/$00/$00). Returns to walking after 6 counter-step frames; if the counter runs out before reaching state-completion, returns to state $00 via `CODE_0F84AE`. |
| `$04` | **Launch-bubble + dance.** | `CODE_0F84DB` | Plays the "throw" anim sequence ($09, $08, $07, hold $20 each). On the second sub-step (`$18,x = 1`), `$7400` mirrors the Yoshi-relative facing in `$77C2`. After all 3 sub-steps + an idle `$7A98` countdown, calls `CODE_0F8521`: spawns a child $019 Bubble at offset +/-$08 X from Yoshi with X-vel `$FD00`/`$0300` and 10-frame anim timer. Then returns to state $00 by way of `CODE_0F8511` -> `CODE_0F84AE` (resets to walk). |

Per-slot state:

| Address | Meaning |
|---|---|
| `$16,x` | State byte (0 / 2 / 4 -- always even, multiplied by 2 to index DATA_0F83C5 by word). |
| `$18,x` | Sub-state -- counts frames within state $04, doubles as anim-frame index. |
| `$7400,x` | Facing direction (0 = right, 2 = left). Selected from sign of Yoshi-relative X, or via XOR rotation in state $02. |
| `$7402,x` | Animation frame -- 0..0B (walk frames) or 7..9 (launch frames). |
| `$7A96,x` | Per-frame anim cooldown -- decremented by walk handler; on expiry advances animation. |
| `$7A98,x` | "Emote-cooldown" -- decremented in state $00, when 0 triggers AmbSpr$0212 spawn. |
| `$7AF6,x` | State-completion lockout -- prevents re-launching too soon after a previous bubble. |
| `$77C2,x` | Yoshi-facing reference (auto-updated by engine; copied into $7400 during state $04 transition). |
| `$701900,x` (EXRAM) | One-frame init guard (set on first Init pass; subsequent re-spawns through Init use the stored value). |
| `$701902,x` (EXRAM) | Either an X-velocity seed (top byte of DATA_0F835C entry) on first init, or a fixed `$0800` for subsequent inits. Used in render via `CODE_0F858F` to lookup tile-attribute bits. |

The state machine reuses tables aggressively:
- `DATA_0F8519` / `DATA_0F851D` (each 2-entry) for bubble velocity
  and X-offset paired by `$7400` facing.
- `DATA_0F846F` / `DATA_0F8477` (each 8-entry) for pivot animation
  and hold times in state $02.
- `DATA_0F84D2` / `DATA_0F84D5` / `DATA_0F84D8` (each 3-entry) for
  the launch-pose sequence in state $04.

### 3.3 Spawn parents

Crazee Dayzee has **no spawn parents**. It is always placed
directly from level data (the sprite-list entry stream described in
`docs/leveldataengine.md`). There is no winged-cloud-with-Dayzee
variant, no enemy-drop, no boss-conversion.

The closest semantic relative is the `$181 CrazeeDayzee` ->
`$019 Bubble` child spawn in state $04: the Dayzee periodically
fires a Bubble (the projectile-style sprite documented in
Bank04.asm:725-770), but the Bubble doesn't transmute back into a
Dayzee or anything else -- it's a one-way child spawn.

### 3.4 Head-bop response

The stomp routine at Bank0F:812 is short:

```
YI_NorSpr181_CrazeeDayzee_StompRt:
head_bop_crazee_dayzee:
    LDA #!Define_YI_SoundID39_PiranhaPlantMunch  ; Note (asm): doesn't
                                                    ; actually play -- gets
                                                    ; overwritten by a later
                                                    ; sound queue.
    JSL CODE_push_sound_queue
    LDA EXRAM_GenericTable701902,x  ; load stored tile-attribute bits
    XBA                              ; swap byte halves
    STA $00                          ; pass to head-bop dance routine
    JSL CODE_07FD68                  ; head-bop dance animation
    JML CODE_despawn_sprite_free_slot
```

The interesting bits:
- The asm comment in the file explicitly flags that
  `SoundID39_PiranhaPlantMunch` is never heard -- it's queued but
  immediately overwritten by a higher-priority sound (likely the
  bop-impact SFX from the engine). This is a latent design quirk
  preserved in the original game.
- `CODE_07FD68` is the shared head-bop-dance routine in Bank07 (the
  "Yoshi bounces off enemy with little stars" animation). The
  Dayzee passes the parent slot's stored tile-attribute bits
  through `$00` so the dance uses the right palette.
- The slot is then released to the free pool via
  `CODE_despawn_sprite_free_slot`. There's no "stunned and respawn"
  -- one stomp kills.

### 3.5 Cross-references

- `yi/Banks/Bank0F.asm:453-822` -- the full Crazee Dayzee block:
  `init_crazee_dayzee`, `main_crazee_dayzee`, the 3 state handlers
  (CODE_0F83E3, CODE_0F8487, CODE_0F84DB), the bubble spawner
  CODE_0F8521, the render helper CODE_0F858F, the Yoshi-contact
  helper CODE_0F85CB, the emote-spawn helper CODE_0F85FC, and
  `head_bop_crazee_dayzee`.
- `yi/Banks/Bank04.asm:725-770` -- $019 Bubble's Init/Main, the
  child sprite Dayzee spawns in state $04.
- `yi/Banks/Bank07.asm:15748` -- `CODE_07FD68`, the shared
  head-bop-dance routine all stomp-killed sprites in this style
  share.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical ID $181
  CrazeeDayzee.
- `yi/Constants/AmbientSpriteIDs.asm` -- $0212 "happy notes" emote
  spawn (note: the upstream constant comment marks $0212 as
  "(not used in game)" -- actually it's used here in state $00 of
  Crazee Dayzee, so the constant comment is slightly inaccurate).
- `docs/spritestateengine.md` -- the engine that runs the 3-state
  dispatch each frame.
- `docs/family-clouds.md` -- no Dayzee variant exists, but the
  family doc explains the same "kid-friendly enemy" aesthetic
  convention.
- `yoshisisland-disassembly/disassembly/bank0F.asm` -- Raidenthequick
  labels `init_crazee_dayzee`, `main_crazee_dayzee`,
  `head_bop_crazee_daisy` (note the alt spelling; the asm here uses
  `head_bop_crazee_dayzee`).
- `ys_enmy.asm`, `ys_enmy2.asm`..`ys_enmy14.asm` -- the parallel
  asm family the Dayzee state machine cross-references in the
  in-file comment block at Bank0F:461.

---

## 4. Little Mouser family ($02F / $030 / $032 / $033 / $1A3)

Five sprite IDs implementing YI's "ground-hopping mouse, peeks out of
a hole, steals Yoshi's eggs" enemy. All five live contiguously in
`Bank0C:4332-7076`. Three of them (the nest $02F, the peek-from-nest
$032, the exit-from-nest $033) form a state-machine pipeline that
ends with a `CODE_spawn_sprite` call that morphs the slot into $030
LittleMouser proper -- the free-roaming, egg-stealing mouse with the
8-state behaviour. $1A3 LittleSkullMouser is a tonal cousin: it
walks like a $030 but is the world-5 castle "Goomba" variant
(invulnerable to head-bop, takes only egg / Yoshi-from-side hits).

The whole family shares the squeak SFX `SoundID75_LitterMouserSqueak`
(asm spells it "Litter" -- preserved verbatim from the constant
table; the canonical asset is "Little Mouser Squeak"). The defining
mechanic is the egg-grab: any active $030 in carry state aims at
the nearest live egg slot ($022-$025), grabs it by writing back-
pointer into `$76,x` and asserts the `$7019D8` "held" flag on the
target egg so other mousers don't double-claim it.

### 4.1 ID table

| ID | Constant name | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$02F` | `LittleMouserHole` | `init_little_mouser_nest` Bank0C:4376 (`STZ $7400,x; RTL`) | `main_little_mouser_nest` Bank0C:4387 (`JSL CODE_03AF23; RTL`) | -- | The nest itself. Pure-decoration anchor sprite -- a hole rendered in the BG that other mousers spawn from / dive back into. Has no state machine. Acts as a level-data marker. |
| `$030` | `LittleMouser` | `init_little_mouser` Bank0C:4636 | `main_little_mouser` Bank0C:4722 | shared engine head-bop | The free-roaming variant. 8-state machine: walk / pivot / sniff / grab-egg / carry / drop / squashed / vanish. On Init, optionally spawns a child $025 FlashingEgg via `CODE_spawn_sprite_active` at offset `(spawn_X, spawn_Y-$10)` -- the "pre-loaded with stolen egg" variant from $70E2 bit-4. |
| `$032` | `PeekingLittleMouser` | `init_little_mouser_in_nest` Bank0C:4398 | `main_little_mouser_in_nest` Bank0C:4430 | -- | The "head poking out of nest" variant. 2 high-level states: cycle-anim (idle peek with a 4-pose tile cycle) and emerge (5-substate animation: lift / hop / lunge / land / vanish-then-spawn-$030). $70E2 bit-4 picks a left-facing or right-facing init variant. |
| `$033` | `LittleMouserExitingNest` | `init_little_mouser_from_nest` Bank0C:5501 | `main_little_mouser_from_nest` Bank0C:5565 | -- | The most elaborate Mouser. 3 high-level states (exit-sequence / carry-egg / leave-screen). Exit-sequence is an 8-substate choreography: rise / hop / lunge / land / pause / leap / squeak / cleanup. When status hits $08 the slot is morphed into $030 via `CODE_spawn_sprite` (Bank0C:5571), inheriting the slot. The Init splits between two style variants on `LevelHeaderBG1Tileset == 3` (castle theme). |
| `$1A3` | `LittleSkullMouser` | `init_little_skull_mouser` Bank0C:6827 (RTL) | `main_little_skull_mouser` Bank0C:6887 | (none -- damages Yoshi on top via `CODE_03A590` reflect) | A walking skull-faced mouse. 2-state Main: active / despawn. Walks-and-leaps with $76,x timer-driven squeak emission, fires a $1EF ambient puff on death, and morphs into $030 on egg-hit (status $08 spawn-sprite handoff). Invulnerable on top -- when Yoshi lands on it the floor-bonk routine `CODE_03A590` runs as if Yoshi hit a wall, kicking Yoshi off. |

The whole family is wired around a slot-recycle pattern: $032 and
$033 don't have their own "after I'm done, become a different
sprite" mechanism -- they call `CODE_spawn_sprite` with target ID
$030 and (because spawn_sprite writes the new sprite into Y's
slot) the active slot transparently becomes a $030, preserving X,
Y, and EXRAM fields. The "carry me back to the nest" behaviour in
$030 then references the original $032/$033 slot by stored Y-back-
pointer in `$76,x`.

### 4.2 The $02F nest (decoration anchor)

The nest itself is almost a no-op:

```
init_little_mouser_nest:           ; Bank0C:4376
    STZ.w $7400,x                  ; facing = 0 (right)
    RTL

main_little_mouser_nest:           ; Bank0C:4387
    JSL.l CODE_03AF23              ; standard engine tick (physics + render)
    RTL
```

The nest is solid graphics -- it gets rendered each frame by the
engine's standard sprite-OAM submission, has the hitbox the level
data prescribes, and does nothing else. **Level data places a
matching $032 or $033 on top of it** to make a Mouser appear to
peek out. There's no spawn-from-nest mechanism inside $02F itself;
it's just a backdrop sprite.

### 4.3 $032 PeekingLittleMouser (in-nest 2-state)

Init splits on `$70E2 & $0010` (level-data flag bit) into two
sub-init paths:

```
init_little_mouser_in_nest:        ; Bank0C:4398
    STZ.w $7400,x                  ; facing = right (overridden below)
    LDA.w $70E2,x : AND #$0010 : LSR : LSR : LSR
    STA.b $16,x                    ; high-level state byte (0=cycle / 2=emerge)
    TAX
    JMP.w (DATA_peeking_mouser_init_variant_ptr,x)

DATA_peeking_mouser_init_variant_ptr:
    dw CODE_0CA119                 ; variant 0 -- left-facing (or right-facing) init
    dw CODE_0CA09D                 ; variant 1 -- store $7182 (Y) -> $78,x and seed emerge
```

Variant 0 (`CODE_0CA119`) is the regular "idle peek-out" init: picks
a random sub-state (0 or 2 via `$10 & $0001`) and loops the first
2-pose tile cycle. Variant 1 (`CODE_0CA09D`) sets `$7402,x = $0008`
(emerge-frame), saves Y-position into `$78,x` and `Y-$18` into
`$7A36,x` (top-of-arc target), then jumps to `CODE_0CA20F` which
seeds `YSpeed = $FC00` and a sub-state of 0 -- this is the "I'm
already emerging" entrance.

Main dispatches on `$16,x` (cycle = 0, emerge = 2):

| `$16,x` | State | Behaviour |
|---|---|---|
| `$00` | **Cycle-anim** (idle peek). Handler `CODE_0CA0F0`. Cycles through `DATA_0CA0CA` / `DATA_0CA0DA` (pair of 8-/9-entry frame tables) with `$7A96,x` controlling per-frame hold. Each cycle finishes with `$76,x` underflowing to -1, at which point `CODE_0CA11B` reseeds with a coin-flip on `$10 & $0001` to pick the next sub-cycle, alternating between the two anim sets. There's no transition-to-emerge from this state -- emerge is *only* entered through variant-1 init. |
| `$02` | **Emerge.** Handler `CODE_0CA143`. Dispatches via 5-entry `DATA_peeking_mouser_emerge_substate_ptr` on `$18,x`: |

The 5 emerge substates (`$18,x`, each handler increments $18,x by 2
to advance):

| `$18,x` | Sub-state | Handler | Behaviour |
|---|---|---|---|
| `$00` | **Lift.** | `CODE_0CA155` | Move Y upward to `$7A36,x` (saved top-of-arc). On reaching, randomly (1-in-4) commit to sub-state 4 vanish, else proceed. |
| `$02` | **Hop / arc.** | `CODE_0CA197` | 7-frame `DATA_0CA182` arc animation. Last frame triggers `DATA_0CA190` (3 entries with $01 flag) which XORs `$7400,x` with `$10 & $01` left-shifted by 1 -- a 1-in-2 facing-flip each anim step. On expiry seeds `YSpeed = $0400` (down) and sets `$18,x = 6` (skip lunge). |
| `$04` | **Lunge.** | `CODE_0CA1D4` | $7A96-timer pause, then seeds `YSpeed = $0400` and `$18,x = 6`. |
| `$06` | **Land.** | `CODE_0CA1E6` | Wait until Y >= `$78,x` (original spawn Y, i.e. back at the hole). Snap Y back; pick a 64+random $7A96 idle delay; advance to sub-state 8. |
| `$08` | **Vanish.** | `CODE_0CA208` -> `CODE_0CA20F` | After idle delay, seeds `YSpeed = $FC00` (jump up out of nest) and `STZ $18,x` (reset chain). |

This "lift -> hop -> lunge -> land -> vanish" is a partial loop --
after $08 vanish, the slot becomes another emerge from $00 again.
The mouse pops in and out of the hole indefinitely until killed.

### 4.4 $033 LittleMouserExitingNest (8-substate exit)

The most intricate Mouser variant. Init at Bank0C:5501 is
tileset-gated:

```
init_little_mouser_from_nest:
    STZ.w $7400,x
    LDY.w !RAM_YI_Level_LevelHeaderBG1TilesetLo
    CPY.b #$03                     ; tileset 3 == castle
    BEQ.b CODE_0CA946              ; castle path: more elaborate setup
    LDA.w $6FA2,x : ORA #$0141     ; non-castle: short startup, state=4 (sub-init)
    ...
    LDA.w #$0004 : STA.b $16,x     ; high-level state = "carry-egg" (?!)
    SEP #$20 : LDA #$02 : STA $19,x ; substate hint
    ...
```

Wait -- a 3-state dispatch where state `$04` would index past entry
3? Look at the dispatch table:

```
DATA_mouser_from_nest_state_ptr:    ; Bank0C:5595
    dw CODE_0CA9CE         ;  $00 -- exit-sequence (the 8-substate)
    dw CODE_0CAC25         ;  $02 -- carry-egg (the 9-substate)
    dw CODE_0CAEE1         ;  $04 -- leave-screen
```

(state indices 0/2/4, byte-doubled to word-index). So the
non-castle init starts at the leave-screen state, not the exit
sequence -- which makes sense: in non-castle levels the Mouser
exits the nest as a one-shot animation that ends quickly. Castle
levels run the full 8-substate emerge -> 9-substate carry chain
before despawning the slot.

Main dispatches on `$16,x` (state) -> `DATA_mouser_from_nest_state_ptr`,
each of which sub-dispatches on `$18,x`:

| `$16,x` | High state | Substate handler table | Substates |
|---|---|---|---|
| `$00` | **Exit-sequence.** | `DATA_mouser_from_nest_exit_substate_ptr` (8 entries, Bank0C:5610) | rise / hop / lunge / pause / leap / squeak / cleanup / final |
| `$02` | **Carry-egg.** | `DATA_mouser_from_nest_carry_substate_ptr` (9 entries, Bank0C:5913) | carry-up / position-1 / drop / position-2 / shared-leap / carry-down / position-3 / land / spawn-mouser |
| `$04` | **Leave.** | `CODE_0CAEE1` | One-way despawn or morph into $030. |

The 8-entry exit-sequence (`DATA_mouser_from_nest_exit_substate_ptr`):

| `$18,x` | Sub-state | Handler | Behaviour |
|---|---|---|---|
| `$00` | **Rise.** | `CODE_0CA9ED` | Use `DATA_0CA9E7`/`DATA_0CA9EA` (3-entry frame/duration tables) to play the "rising from nest" frame loop. On finish: write `$7402,x = $07` (emerge tile), Y -= 10 pixels, YSpeed = `$FD00`. |
| `$02` | **Hop.** | `CODE_0CAA27` | Query FXCODE-derived terrain (`$701902` back-pointer to level-data slot, looks at byte `$700026,x`) for terrain types $100, $103, $104..$10A (slope shapes). If matched, ROR the Y-speed (slope-attenuate descent), set anim to $08, restart $7A96 = 3, advance substate. Otherwise stay. |
| `$04` | **Lunge.** | `CODE_0CAA63` | Same FX-terrain query against byte `$700026,x` (terrain at +1 row down) for tile values $28, $29, $2A, $2D. On match either commits to "stand on this tile" (`CODE_0CAA8D` -> sub 6 with frame 5/anim $74A2=5) or jumps to sub-substate via $19. Issues `SoundID75_LitterMouserSqueak` on commit. |
| `$06` | **Pause.** | `CODE_0CAAF0` | 2-entry alternating frame loop with X-facing XOR. On finish: orient $7402=$09, YSpeed = $FE80 (big upward jump). |
| `$08` | **Leap.** | `CODE_0CAB3F` | Stub: set $6FA0 priority bits + force frame $74A2=7 (mid-leap). Falls into next. |
| `$0A` | **Squeak.** | `CODE_0CAB5B` | Re-query FXCODE terrain (now `$700006,x`) for tiles $28-$2A or $2D. On match: zero Y-speed, set frame $0A (sniff-on-ground), apply YSpeed = $0300 (settle), advance substate. |
| `$0C` | **Cleanup-and-find-egg.** | `CODE_0CAB99` | Search for nearest live egg (status $10, ID $022-$025) within hitbox. On match: zero Y-speed, snap Y to egg's Y, choose 2-frame anim from $7A36/$7A38 (DATA_0CB1A3/DATA_0CB1A7) seeded by `$10 & $0001`, blink for $20+random frames, transition into the carry-egg state ($16,x = $02). |
| `$0E` | **Final.** | `CODE_0CB1CF` | (the "no egg found" final) -- detailed in the carry-egg state's spawning path. |

The carry-egg state ($16,x = $02) cycles 9 substates:

| `$18,x` | Sub-state | Handler | Behaviour |
|---|---|---|---|
| `$00` | **Carry-up.** | `CODE_0CAC3F` | Apply YSpeed = $FD00 (upward), look for level-data tile $0000 (open air) above. On found: set frame 0, $19 = 3, $7402 init. Falls into next on tile-$0000-found path. |
| `$02` | **Position-1.** | `CODE_0CACC1` | Run 4-entry frame cycle from `DATA_0CAAE0` while $19 counter still positive. Then commits to `$7402=$0D` (drop-frame), YSpeed = $0180 (slow drop), emits `SoundID75_LitterMouserSqueak`. |
| `$04` | **Drop.** | `CODE_0CAD09` | Same FXCODE terrain query as exit-sub-state $02 (hop): if landing on slope tiles, restart the lift-up sequence. Otherwise stay. |
| `$06` | **Position-2.** | `CODE_0CAD56` | 4-entry frame cycle (same data as $02), with the X-facing XOR each step. On expiry: $7402=$0D again, YSpeed = $0180 (commit to slow descent). |
| `$08` | **Shared-leap.** | `CODE_0CAB3F` (same as exit-sub-state $08) | Same "raise priority + lock frame" stub. |
| `$0A` | **Carry-down.** | `CODE_0CADA5` | YSpeed = $0300 (faster drop), frame = $0E. |
| `$0C` | **Position-3.** | `CODE_0CADD8` | AABB-check against the still-tracked egg slot ($76,x back-pointer). On overlap: snap to egg, switch frame to $0F, sub-state advances. |
| `$0E` | **Land.** | `CODE_0CAE3B` | Final 2-step animation ($7402 cycles $10, $7A96 = 3 each). Advances on $19 underflow. |
| `$10` | **Spawn-Mouser.** | `CODE_0CAE90` -> `CODE_0CB2C2` | FXCODE_099FA5 collision check; if not currently overlapped with anything, spawn a $030 LittleMouser into the slot via `CODE_spawn_sprite`, set its `$701900 = 1`, status = 2 (live), then RTL. The slot is now a $030. |

The pattern: the $033 sprite **acts out an elaborate exit-from-nest
animation** and then -- without using sprite-spawn for the
"transition" -- calls `CODE_spawn_sprite` in its own slot, which
overwrites the current slot's ID byte with $030. From the engine's
perspective the slot is now a different sprite, and the very next
frame the dispatcher calls `main_little_mouser` (the $030 Main)
instead. All EXRAM state (position, X-speed, facing) is preserved.

### 4.5 $030 LittleMouser (8-state free-roaming + egg-grabbing)

Init at Bank0C:4636 has two paths gated by `$701900`:

```
init_little_mouser:
    LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900,x
    BEQ.b CODE_0CA24F              ; first-time spawn path
CODE_0CA221:                       ; subsequent re-init path
    SEP #$20 : LDA #$01 : STA $701900,x   ; mark initialized
    LDA #$02 : STA $18,x                  ; substate = 2 (cycle-anim sub)
    ...
    LDY $7400,x : LDA DATA_0CA218,y : STA XSpeed,x ; XSpeed from facing-indexed table
    LDA #$FFFF : STA $76,x        ; "no parent egg slot" (NULL link)
    RTL

CODE_0CA24F:                       ; first-time path
    SEP #$20 : LDA $70E2,x : AND #$10 : LSR : LSR : LSR : INC
    STA $701900,x   ; init flag = 1 if bit-4 clear, 2 if set
    ...
    LDA $70E2,x : AND #$10 : ...
    PLY : DEY : BNE CODE_0CA289   ; if flag=2 path: spawn child egg
    LDA #$FFFF : STA $76,x         ; flag=1 path: no egg
    RTL

CODE_0CA289:                       ; flag=2 path: spawn child $025 FlashingEgg
    LDA #$0025 : JSL CODE_spawn_sprite_active
    BCC .nokid    ; if no free slot, fall back to no-egg
    ; ... configure the spawned egg slot: set XSpeed/YSpeed=0,
    ; place at parent's (X, Y-$10), assert "held by parent" via
    ; $7A36,y = 1, link the parent's $76,x to the spawned slot ID.
    RTL
```

This is the "Mouser carries a stolen egg at spawn-time" branch:
$70E2 bit-4 enables a pre-spawned-with-egg variant where the Mouser
gets a $025 egg held in `$76,x` from frame zero.

Main at Bank0C:4722 dispatches on `$16,x` through an 8-state table:

```
DATA_little_mouser_state_ptr:       ; Bank0C:4879
    dw CODE_0CA433  ;  $00 walk
    dw CODE_0CA475  ;  $02 chase
    dw CODE_0CA4CC  ;  $04 sniff
    dw CODE_0CA534  ;  $06 grab-egg
    dw CODE_0CA572  ;  $08 carry
    dw CODE_0CA5DD  ;  $0A drop
    dw CODE_0CA70A  ;  $0C squashed
    dw CODE_0CA7D9  ;  $0E vanish
```

| `$16,x` | State | Behaviour |
|---|---|---|
| `$00` | **Walk.** | Frame cycle from `DATA_0CA46F` (3-entry: $00,$01,$00). Random walk speed seeded each iteration. Emits `SoundID75_LitterMouserSqueak`. Transitions to state $02 (chase). |
| `$02` | **Chase.** | 3-frame anim cycle with X-facing XOR from `DATA_0CA472` (3-entry: $02,$00,$00). On `$19,x` underflow returns to state $00. |
| `$04` | **Sniff.** | Wall-hit check ($7860 & $000C); if wall, transition to state $06. Off-screen check: if Yoshi is too far away, force walk-back ($6FA2 priority bits + jump to walk state). Otherwise apply XSpeed from facing. |
| `$06` | **Grab-egg.** | Plays squeak, queues YSpeed = $FC00 (jump), advances to state $08. |
| `$08` | **Carry.** | Y-bucket-indexed frame select ($18, $19, $1A, $1B, $1C, $1D depending on YSpeed band). Mirrors X, Y of held egg slot to follow parent (writes through `$76,x` back-pointer to egg). On floor: zero Y-speed, transition to $0A drop. |
| `$0A` | **Drop.** | Re-search nearest egg (`CODE_0CA8C2` FXCODE_099FA5 query). On found: assert "held" flag on egg + assign $7A36 = 1 (we own this egg), transition to $0C squashed (which is actually "search-for-next" semantic, not death). |
| `$0C` | **Squashed.** | Checks if the held egg is still alive (status $10) and being carried by us ($7019D8 = 0 means free, !=0 means another mouser claimed it). If still ours: search/locomote. If lost: clear `$76,x = $FFFF` (forget egg), play squeak, transition to $0E vanish. |
| `$0E` | **Vanish.** | Same despawn checks but with $7A36 fork: leaves the slot or recycles into walk depending on `$78,x` (saved prev-state). |

The egg-search path (`CODE_0CB21B`, used by both state $0C and the
$033 carry-egg substates) uses **SuperFX FXCODE_098EBF** to scan the
sprite slot table for an active egg ($022-$025, status $10,
`$7019D8 == 0`, `$7019D7` >= 0). It returns the egg's slot index in
R1, or negative if nothing matches. This SuperFX-accelerated search
is also used by the $033 LittleMouserExitingNest in its egg-pickup
substate.

Per-slot state held in a $030:

| Address | Meaning |
|---|---|
| `$16,x` | High-level state (0/2/4/.../E). |
| `$18,x` | Sub-state / per-state frame counter. |
| `$19,x` | Down-counter; on underflow advances state. |
| `$76,x` | Back-pointer to held egg slot (or $FFFF = none). |
| `$78,x` | Saved previous-state byte (used by state $0E/$0C). |
| `$7400,x` | Facing (0 / 2). |
| `$7402,x` | Render frame. |
| `$7A36,x` | "We're carrying" flag (1 = yes, 0 = no). |
| `$7A96,x` | Per-state timer countdown. |
| `$7A98,x` | Animation frame-hold timer. |
| `$701900,x` (EXRAM) | Initialization sentinel (0 = first init, 1+ = re-init). Also encodes which init branch was taken. |
| `$701902,x` (EXRAM) | Back-pointer to spawner slot (used by $033 in exit-sequence). |
| `$7019D8,y` on held egg | "Held by some mouser" flag on the egg sprite slot (cross-slot lock). |

### 4.6 $1A3 LittleSkullMouser (the world-5 castle variant)

Init is a single `RTL`. All state comes from level data (position,
facing). Main at Bank0C:6887 is a 2-state dispatcher:

```
DATA_little_skull_mouser_state_ptr:    ; Bank0C:6894
    dw CODE_0CB375     ;  state $00 -- active
    dw CODE_0CB455     ;  state $02 -- post-egg-hit (despawn / morph into $030)
```

State $00 (active) is the bulk. It runs:

1. **Yoshi-touch handling** (`CODE_0CB406`): if Yoshi is holding the
   sprite slot ($7D38 set on Yoshi-self-slot), the mouse bounces
   sideways in Yoshi's direction (X-vel = -$100 if Yoshi velocity
   negative, else +$100), sets `$7A36 = 2` to lock the bounce-state
   for one tick, and runs `CODE_03B24B` (the universal "spawn dust
   puff" routine). This is the "Yoshi knocks the mouser away" path.
2. **Stomp / contact** (the `CODE_0CB311` middle routine, called via
   `$7D38` check): if Yoshi is *standing on* the skull mouser:
   - $7860 & $0001 (floor-touch) sends Yoshi recoil via
     `CODE_03A590` (the "you can't stomp this" knockback).
   - $78,x is the "wear-out counter": when Yoshi has bounced off
     enough times ($78,x >= 3), the skull mouser despawns via
     `CODE_03B078` (jumps to ground via JML so it can clean up state).
3. **Leap timer** (CODE_0CB394/0CB3C3/0CB3D5): every `$76,x`-driven
   interval, leap upward (YSpeed = $FD00), emit
   `SoundID75_LitterMouserSqueak`, and re-seed X-speed from facing.
   The leap timer is reset to 4 frames between phases.

State $02 (post-egg-hit) at Bank0C:7008:

- If status is $08 (egg-hit, animation completing), call
  `CODE_spawn_sprite` with target ID $030 -- the skull mouser
  becomes a regular $030 LittleMouser. Slot is preserved.
- If still alive ($7D38 hand-off from Yoshi-stomp via
  `CODE_03B20B` and `CODE_0CFF61` -- the latter is the standard
  stomp-effect spawn), play `SoundID1C_StompEnemy`, force
  $74A0 = $FF (max-bright tint), and despawn via `CODE_03A31E`.
- Otherwise, advance the 11-entry death anim from
  `DATA_0CB43F`/`DATA_0CB44A` (frame/hold tables). At frame index
  $01 (second frame), spawn ambient $219 puff via `CODE_0C9C7E`.
  When index reaches $0B, spawn $030 with active status and exit.

The "invulnerable on top" rule is implemented by:
1. Skipping the standard stomp-kill path on direct head-bop.
2. Sending Yoshi reflect via `CODE_03A590`.
3. Only state $02's `CODE_07FD6C` path (Yoshi-from-side-hit) kills
   it -- which corresponds to Yoshi *spinning* or *throwing eggs*,
   not direct foot-stomp.

### 4.7 Shared infrastructure

**`CODE_0CB21B`** -- the SuperFX-accelerated egg-search via
FXCODE_098EBF. Called from $030 state $0C, $033 exit-substate $0C
(cleanup-find-egg), and $033 carry-substates $00 and $0C. Inputs:
TXA (parent slot) into R1. Outputs: R1 = egg slot or negative if
nothing matches; engine filters to active $022-$025 sprites with
free-egg ($7019D8 == 0) and not-too-far-up ($7019D7 >= 0).

**`CODE_0CB29D`** -- the head-bop / Yoshi-jump-on-head check called
from $033 main. Reads `$6FA0 & $0040` (sprite-can-be-mounted bit)
and `$61D6` (egg-throw lockout). If Yoshi is jumping on the slot,
calls `CODE_07FC2F` (the standard "Yoshi mounted enemy" check) and
returns control via PLA + JSL CODE_03A5B7 (engine post-tick); else
returns RTS normally.

**`CODE_spawn_sprite` slot-recycle pattern.** Both $033 (multiple
times) and $1A3 (post-egg-hit) use a non-standard call form:
```
LDA.w #!Define_YI_NorSpr030_LittleMouser
TXY                              ; Y = the slot we're in
JSL.l CODE_spawn_sprite           ; spawn $030 *into our slot*
SEP #$20 : LDA #$01 : STA $701900,x  ; mark "re-init" flag
REP #$20 : RTL
```

The TXY before JSL is the key -- it makes `CODE_spawn_sprite` use
the *parent's own slot* as the destination, effectively rewriting
the slot's ID byte. On the next frame the engine dispatcher reads
the new ID and calls $030's Init (taking the `$701900 != 0` re-init
branch which skips the first-time-spawn $025 egg-child branch).
This is the same trick the watermelon family uses for the
fire/freeze child spawns (§2.3) but inverted -- here the *parent*
becomes a different sprite, while watermelons spawn a *separate*
child slot.

### 4.8 Cross-references

- `yi/Banks/Bank0C.asm` -- the full Mouser cluster (4332-7076).
- `yi/Banks/Bank0C.asm:6824-7076` -- $1A3 LittleSkullMouser.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $02F / $030 /
  $032 / $033 / $1A3, plus $022-$025 FlashingEgg / GreenEgg /
  RedEgg / YellowEgg / GiantEggLauncher (the egg-target IDs the
  Mouser's grab routine recognizes).
- `yi/Constants/SoundIDs.asm` -- `SoundID75_LitterMouserSqueak`
  (the squeak SFX -- ASCII spelling preserved verbatim from the
  audio-engine constant table; canonical is "Little Mouser Squeak").
- `docs/spritestateengine.md` -- the engine dispatcher that calls
  `main_*` each frame.
- `docs/leveldataengine.md` §3 -- how $02F / $032 / $033 get
  placed in the per-level sprite stream.
- `docs/family-misc.md §1` (Door family) -- another single-bank
  multi-sprite-with-shared-Main family, with similar dispatch.
- `yoshisisland-disassembly/disassembly/bank0C.asm` -- Raidenthequick
  descriptive labels:  `init_little_mouser_nest`,
  `main_little_mouser_nest`, `init_little_mouser_in_nest`,
  `main_little_mouser_in_nest`, `init_little_mouser`,
  `main_little_mouser`, `init_little_mouser_from_nest`,
  `main_little_mouser_from_nest`, `main_little_skull_mouser`.
  (Note: Raiden labels the $1A3 Init as `init_little_skill_mouser`
  -- a typo; corrected in our framework to `init_little_skull_mouser`.)
- `ys_mouse0.asm` / `ys_enmy.asm` -- parallel asm for the mouser
  family in the SuperFX-mode source.

---

## 5. Toady family ($058 / $05C / $091)

Three sprite IDs implementing Kamek's flying winged-minion enforcers
-- the "Toadies" who abduct Baby Mario when Yoshi gets hit. Two
direct-spawn variants ($058 Green, $05C Pink) share a single
`main_toadies` body and 6-state dispatch table at Bank0E:11656-12321.
The third ($091 4-Red-Toadies) is a self-contained 4-quartet ambush
at Bank04:10887-11206 with its own 5-state machine and its own
private RAM block at `$0E2D..$0EC9` (a 16-byte-per-toady scratch
region).

The defining mechanic: when Yoshi loses Baby Mario (`$60C0` star-
timer reaches zero, or game state matches certain triggers), one of
the Toady variants intervenes. The Green and Pink Toadies are the
single-direct-spawn variant -- they descend on Yoshi, grab Baby
Mario at body contact, and carry him offscreen. The 4-Red-Toady
ambush is the dramatic version -- four Toadies swoop in formation,
intercept Yoshi, and trigger the Game-Over sequence.

### 5.1 ID table

| ID | Constant name | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$058` | `GreenToady` | `init_toadie` Bank0E:11659 | `main_toadies` Bank0E:11709 (shared with $05C) | shared engine stomp | Green Toady. Standard variant. On Init: stores 8-bit X-tile + 8-bit Y-tile encoded into `$701900` as the "patrol origin", sets state `$76 = 2` (wander). Has 6-state machine: wander / pursue / Mario-hit / lift / carry / drop. |
| `$05C` | `PinkToady` | shared `init_toadie` | shared `main_toadies` | shared | Pink Toady. Stronger / faster variant. Differs from $058 only in: (1) Init path -- on body contact $74A2 = 2 instead of $05C's default; (2) main_toadies branch at Bank0E:11718 conditional on sprite-ID = $058 deals with the green-only egg-hit-immunity; (3) damage table `$74A2` resolved per-frame. No code-divergence beyond these two ID-checks. |
| `$091` | `4RedToadies` | `init_four_red_toadies` Bank04:10887 (RTL stub) | `main_four_red_toadies` Bank04:10905 | -- | The 4-Red-Toady ambush quartet. Bookkeeping in `$0E2D..$0EC9` -- a 16-byte-per-toady scratch region with 4 toady slots. Triggered when the level's star-timer drops below `!Define_YI_Level_StarTimerThatSpawnsToadiesThreshold` ($0A frames). All 4 toadies share a single sprite slot; positions and substate are stored in the dedicated WRAM block. |

### 5.2 Shared `init_toadie` (Bank0E:11659)

```
init_toadie:
    LDA #$0000 : STA $78,x         ; sub-state clear
    STZ.w $701902,x                ; baby-Mario-carrying flag = 0
    LDA $701901,x                  ; check "have I been initialized before"
    CMP #!Define_YI_NorSpr058_GreenToady
    BEQ .green_path                ; green = standard
    LDA $701900,x : BEQ .first_init  ; pink + first-time
    JSR CODE_0EDE60                ; pink subsequent: reuse sprite blob (no patrol-origin reset)
    LDY #$05 : STY $76,x           ; state = $05 (final-state, fall through to carry-off)
    RTL
.first_init:
    LDA $7182,x : LSR #4 : XBA : STA $00    ; Y-tile (upper byte)
    LDA $70E2,x : LSR #4 : ORA $00          ; X-tile in lower byte
    STA $701900,x                  ; encode patrol origin: $YYXX in $701900
    LDY #$02 : STY $76,x           ; state = $02 (pursue)
.green_path:
    RTL
```

This encodes the spawn position as a single 16-bit tile coordinate
(YYXX in `$701900`) which the Toady uses later to compute "go home"
direction. The first-time-Init path always starts in state $02
(pursue Yoshi); the "re-init via spawn-sprite" path (which happens
when, e.g., $091 morphs a slot back) starts in state $05 (final
drop-and-disperse).

### 5.3 Shared `main_toadies` (Bank0E:11709)

The 6-state dispatch table:

```
DATA_0EDB34:                       ; Bank0E:11698
    dw CODE_0EDC86     ;  $00 -- wander / orbit patrol origin
    dw CODE_0EDD6F     ;  $01 -- pursue Yoshi (with vertical hover)
    dw CODE_0EDE44     ;  $02 -- Mario-hit (just grabbed Baby Mario)
    dw CODE_0EDE79     ;  $03 -- lift Yoshi off screen
    dw CODE_0EDF03    ;  $04 -- carry Yoshi away horizontally
    dw CODE_0EDFBD     ;  $05 -- drop-and-disperse (final)
```

| `$76,x` | State | Behaviour |
|---|---|---|
| `$00` | **Wander.** | Hover near `$701900` patrol origin. Random X/Y oscillation seeded by `$10`. Watch for Yoshi proximity check (mountless-mario, `$60AB` ball-flying-flag negative) to transition to state $01. |
| `$01` | **Pursue.** | Compute direction-to-Yoshi using `DATA_0EDC74`/`DATA_0EDC80` (per-quadrant velocity tables). 4-quadrant 2-axis sin/cos approximation: read `$60A8` (Yoshi X-vel) and `$60AA` (Yoshi Y-vel), normalize, apply trig table lookup. Sets `$75E0`/`$75E2` (X/Y velocity 16-bit signed). On body contact with Yoshi (carrier-status check at Bank0E:11784): transition to state $02. |
| `$02` | **Mario-hit.** | "I grabbed Baby Mario." `$74A2 = 2` (palette change), zero X/Y vel, kick `SoundID3A_StompShyGuy` (the "got him" SFX). Writes `$701902 = 1` to mark "carrying" -- which prevents other Toadies from grabbing the same slot. Set `$60C0 = $0006` (post-hit lockout), `$60D2 = $8001` (Yoshi-Mario-stripped flag), `$60AA = $FC00` (Yoshi bounce). Falls through to state $03. |
| `$03` | **Lift.** | Position Toady on top of Yoshi (offset $7CD6 - $7CD8). Slow upward `YSpeed = $FFF2`. After ~12 ticks: state advances to $04. |
| `$04` | **Carry.** | Carry Yoshi horizontally offscreen. X/Y interpolation via stored patrol-origin compared to current Yoshi pos. On reaching screen edge: state $05. |
| `$05` | **Drop-and-disperse.** | X-vel = 0, Y-vel = $FE00 (upward), per-state timer = $20. Once timer drops, Toady is offscreen and self-despawns via standard engine `CurrentStatus = $10` -> `$0E` handler in `main_toadies` body (CODE_0EDBBB at Bank0E:11769). |

### 5.4 Green vs Pink (the actual code divergence)

The two variants differ only in two places:

**A. `main_toadies` line 11718 -- the egg-hit immunity branch.**

```
main_toadies:
    LDA.w !EXRAM_YI_Level_NorSpr_CurrentStatus,x
    CMP.w #$0010                  ; alive?
    BNE.b CODE_0EDBBB             ; no -> despawn handler
    LDA.w $7D38,x                 ; egg-touched flag?
    BEQ.b CODE_0EDB5B
    LDA.w !EXRAM_YI_Level_NorSpr_SpriteID,x
    CMP.w #!Define_YI_NorSpr058_GreenToady
    BEQ.b CODE_0EDB5B             ; green: skip the next 2 lines (immune)
    LDA.w #$0002 : STA.w $74A2,x  ; pink: dim palette ($74A2=2 means "hit")
CODE_0EDB5B:
    ...
```

When egg hits the Green Toady, the `$74A2` damage frame stays at 0
(or whatever Init set it). When egg hits the Pink Toady, `$74A2` is
forced to $02 (the dimmer / hit palette).

The actual kill threshold is the same for both -- both die on
status $0010 + egg-hit chain. The difference is purely visual:
Pink Toadies flash darker when hit; Green Toadies don't.

**B. Init re-spawn path (line 11665-11675).**

```
init_toadie:
    LDA $701901,x                  ; ID
    CMP #!Define_YI_NorSpr058_GreenToady
    BEQ.b .greenPath               ; green: re-init paths sit at standard $76=2
    ; pink path -- the re-spawn case
    LDA $701900,x
    BEQ.b .pinkFirstInit
    JSR CODE_0EDE60                ; reuse blob, state = $05 directly
    LDY #$05 : STY $76,x
    RTL
```

The difference between green and pink re-spawn is whether they sit
at state $02 (pursue, green) or directly at state $05 (drop, pink).
This affects only the $091-spawned Pink Toadies that exit on the
4-Red-Toady's drop-disperse step -- they finish dispersing instead
of re-pursuing.

So Pink vs Green is essentially: (1) hit palette `$74A2`, (2)
re-init state ($05 vs $02). The two main_toadies code paths are
literally byte-identical otherwise.

### 5.5 The 4-Red-Toady ambush ($091, Bank04:10887-11206)

This is the most unusual member of the family. It's a single sprite
slot that renders **4 separate Toadies in formation**. The four are
stored as 16-byte structs at `$0E2D + 0/16/32/48` (overlapping with
the per-toady substate at `$0EC9 + 0/4/8/12`):

```
WRAM block ($0E2D..$0EC9, 4x16 bytes):
  $0E2D, $0E2F   -- toady #0 / #1 substate-trigger flags
  $0E31, $0E33   -- ambush-active flags + global toady counter
  $0E37..$0E3F   -- 4 per-toady fractional-X accumulators
  $0E49..$0E4F   -- 4 per-toady fractional-Y accumulators
  $0E59..$0E5F   -- per-toady status bytes
  $0E69..$0E6F   -- 4 per-toady "swing X-speed" current values
  $0E79..$0E7F   -- 4 per-toady "swing X-speed" target values
  $0E6B..$0E6F   -- per-toady "swing Y-speed" current values  (paired w/ above)
  $0E7B..$0E7F   -- per-toady "swing Y-speed" targets
  $0E89..$0E8F   -- 4 per-toady X-velocity caps
  $0E8B..$0E8F   -- 4 per-toady Y-velocity caps
  $0E99..$0E9F   -- per-toady current direction
  $0E9B..$0E9F   -- "exited / despawned" flag per toady
  $0EA9..$0EAF   -- per-toady animation index ($0..$3)
  $0EAB..$0EAF   -- per-toady animation timer
  $0EB9..$0EBF   -- per-toady frame-step timer
  $0EBB..$0EBF   -- per-toady second timer (anim cycle)
  $0EC9..$0ECF   -- per-toady substate (the 5-state dispatch index)
```

Main at Bank04:10905 is structured as a back-pocket multi-iteration
loop. Each frame:

1. **Render setup** (Bank04:10908-11206 `CODE_04D7EA`): copy each
   live toady's `(x, y)` into the OAM slot, applying flip flags
   from `DATA_04D7E6` (4-entry mirror table).
2. **Ambush trigger gate**: at Bank04:10951-10989, check
   `$0E2D` (already-active flag), `$61B2` (Yoshi-alive),
   `$0B59`/`$0B57` (no items currently active), and
   `!RAM_YI_Level_StarTimerLo` against
   `!Define_YI_Level_StarTimerThatSpawnsToadiesThreshold` ($0A).
   If conditions met and ambush not yet triggered: seed all 4
   toadies with initial X/Y/swing values from `DATA_04D5F4` and
   set `$0E2D = 1`.
3. **Per-toady iteration** (lines 10994-11206, loop counter
   `X = $0C` decrementing by 4 each iteration): for each of 4
   toadies, integrate fractional-X/Y velocities (16-bit Q8.8 math
   via add-with-carry), advance substate via
   `DATA_red_toadies_state_ptr` dispatch.

The 5-state per-toady dispatch:

```
DATA_red_toadies_state_ptr:    ; Bank04:10894
    dw CODE_red_toadies_state_00_idle_watch     ;  $00 -- pre-ambush idle
    dw CODE_red_toadies_state_01_descend        ;  $01 -- descend on Yoshi
    dw CODE_red_toadies_state_02_lift_yoshi     ;  $02 -- lifting Yoshi
    dw CODE_red_toadies_state_03_carry_off      ;  $03 -- carry Yoshi away
    dw CODE_red_toadies_state_04_drop_disperse  ;  $04 -- drop / fly off
```

| Substate | Handler | Behaviour |
|---|---|---|
| `$00` | `CODE_04D86C` (`idle_watch`) | Compute Yoshi-distance via `$7CD6/$7CD8 - $6024/$6026` (toady position). If distance < $18 horizontally and vertically: snap target swing-X/Y and emit `SoundID3D_MarioKidnapped` (the "got him" sound). Increment ambush global counter (`$0E33 + INC + INC`) and advance to state $01. Falls through with Y-speed flipped if Yoshi is moving downward. |
| `$01` | `CODE_04D97E` (`descend`) | Smooth-pursuit toward Yoshi using `DATA_04D96E`/`DATA_04D976` (per-toady offset table). 4-step Yoshi-approach: increment each axis until both within tolerance; on completion advance to state $02. |
| `$02` | `CODE_04D9DC` (`lift_yoshi`) | Wait for `$0E2F == 4` (all 4 toadies arrived). On arrival: increment counter, advance to state $03. First-arriving toady triggers `SoundID3D_MarioKidnapped` again. |
| `$03` | `CODE_04DA0E` (`carry_off`) | Position Toady #6 (index `$06`) anchored to Yoshi (`$70E2 = $6020 - 6`, `$7182 = $6022 - $0F`). When Yoshi reaches top of screen (`$6022 - $609C < $FFF0`): jump to GameMode$12 ("game over") via `CODE_04F6F1` and set `!RAM_YI_Global_CurrentGameMode = !Define_YI_GameMode12`. The other 3 toadies continue rendering during the lift. |
| `$04` | `CODE_04DA7C` (`drop_disperse`) | Drop downward, eventually off-screen. After all 4 are offscreen (`$0E31` underflows to 0 via DEC): zero global state, JSR `CODE_03A31E` to despawn the slot. |

Pink Toady spawning from this state: at substate $04 (drop), if
`$61B2 & $80` is clear (Yoshi alive but not flailing) and the
star-timer is again low, the slot can re-enter substate $00 (with
a re-spawn). But practically the slot self-despawns after one full
ambush cycle.

### 5.6 Cross-references

- `yi/Banks/Bank0E.asm:11656-12321` -- $058 / $05C shared block.
- `yi/Banks/Bank04.asm:10887-11206` -- $091 4-Red-Toadies.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $058 / $05C
  / $091, plus `!Define_YI_Level_StarTimerThatSpawnsToadiesThreshold`
  ($0A) in `yi/Constants/Thresholds.asm`.
- `yi/Constants/GameModes.asm` -- `!Define_YI_GameMode12` (the
  game-over screen the $091 final-state hands off to).
- `yi/Constants/SoundIDs.asm` -- `SoundID3D_MarioKidnapped` (the
  "got him" toady sound).
- `docs/spritestateengine.md` -- the engine that runs `main_*`
  each frame.
- `docs/family-misc.md §1` -- the door family is a comparable
  multi-sprite shared-Main; same dispatch idiom.
- `yoshisisland-disassembly/disassembly/bank04.asm` and `bank0E.asm`
  -- Raidenthequick labels: `init_toadie`, `main_toadies`,
  `init_four_red_toadies`, `main_four_red_toadies`,
  `red_toadies_state_*`.
- `ys_toady0.asm` / `ys_enmy*.asm` -- parallel asm for the Toady
  family.

---

## 6. Grinder / Monkey family ($1A5 / $1A6 / $1A7 / $1A8 / $1A9)

Five sprite IDs implementing YI's "Grinder Monkey" enemies -- the
spear-and-bandana monkeys that variously throw bombs, climb trees,
spit melon seeds, snatch Baby Mario, or simply flee. All five live
in `Bank02:4998-6700`. They share a **single Main** entry point
(`main_grinder_common` at Bank02:5245) and a **6-entry variant
dispatch table** indexed by a per-variant byte each Init writes to
`$701900,x`. This is the cleanest example of a runtime variant-
dispatch family in YI's sprite system.

The 6-entry dispatch table actually has **5 variants + 1 shared
death-pose handler** -- so all dying Grinders, regardless of
variant, run the same shared death-pose animation cycle while still
preserving variant-specific behaviours during the alive states.

### 6.1 ID table

| ID | Constant name | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$1A5` | `RunAwayMonkey` | `init_grinder_runs_away` Bank02:5027 | shared `main_grinder_common` Bank02:5245 | shared engine stomp | Runs away from Yoshi. Init seeds `CODE_02AE77 arg=$02` (variant index = 2), then picks left/right escape direction by querying terrain via `CODE_02ADC1` (FXCODE_0ACE2F). Falls back to default-side if both directions blocked. |
| `$1A6` | `MonkeyWithWatermelon` | `init_grinder_spits_seeds` Bank02:5090 | shared `main_grinder_common` | shared | Spits watermelon seeds and chunks. Init seeds variant=$04, then spawns a child `$007 Watermelon` (the projectile type) at the monkey's position via `CODE_02AEA0`, linking the watermelon back through `$701978,y = parent_slot`. The monkey throws the watermelon at Yoshi periodically. |
| `$1A7` | `HangingMonkeyThrowingBombsNeedlenoses` | `init_seedy_sally` Bank02:5121 | shared `main_grinder_common` | shared | Hangs from a vine, drops bombs / needlenoses. Init seeds variant=$06, picks left/right side by terrain query. Reuses `DATA_02AD8C` for horizontal spawn offset. The "needlenose" projectiles spawn from this variant. |
| `$1A8` | `ThiefMonkey` | `init_grinder_grabs_baby_mario` Bank02:5157 | shared `main_grinder_common` | shared | Steals Baby Mario on contact. Init seeds variant=$08; no extra setup. The shared Main runs the snatch-Baby-Mario cinematic when Yoshi makes body contact. |
| `$1A9` | `HangingMonkeySpittingSeeds` | `init_grinder_spits_seeds_climbing` Bank02:5105 | shared `main_grinder_common` | shared | Climbing variant. Init seeds variant=$0A, clears priority bits ($6FA2 &= $FFE0), sets climbing-frame attributes ($7042 \|= $30), XORs facing, then falls into shared spit-seed spawner. Drops seeds while climbing a vine. |

### 6.2 Shared `CODE_02AE77` -- the variant-byte seeder

All 5 Inits funnel through this routine (Bank02:5164):

```
CODE_02AE77:
    LDY.w !EXRAM_YI_Level_NorSpr_GenericTable701900,x
    BEQ.b CODE_02AE9C              ; first-time path
    PLA                            ; (subsequent: pop and re-init)
CODE_02AE7D:
    LDA.w $7042,x : ORA #$0008 : STA $7042,x   ; mark sprite as "killable"
    SEP #$20
    LDA #$FF : STA $74A0,x          ; max-brightness palette init
    REP #$20
    LDA.w #$0010 : STA $7A38,x       ; arming bytes
    LDA.w #$000C : JSR CODE_02B6B2  ; engine kill-sprite-by-tile setup
    RTL

CODE_02AE9C:                        ; first-time path
    STA $701900,x                   ; store variant byte (caller-passed A)
    RTS
```

The caller passes A = $02 / $04 / $06 / $08 / $0A and `JSR
CODE_02AE77`. On first call, A is stored into `$701900,x` -- this
is the variant index. Subsequent re-init calls (e.g. via spawn-
sprite from a different state) take the `PLA` branch (eat caller's
return address) and run a kill-init sequence.

The variant byte values are intentional 2-step strides ($02, $04,
$06, $08, $0A) -- they're used directly as word-index offsets into
the 6-entry dispatch tables, so each variant uses `*$04+$02..$0A`.

### 6.3 The two dispatch tables

```
DATA_grinder_main_ptr:                          ; Bank02:5367
    dw CODE_grinder_main_run_away              ;  $02 RunAwayMonkey ($1A5)
    dw CODE_grinder_main_watermelon            ;  $04 MonkeyWithWatermelon ($1A6)
    dw CODE_grinder_main_hanging_throw         ;  $06 HangingMonkeyThrowing ($1A7)
    dw CODE_grinder_main_theif                 ;  $08 TheifMonkey ($1A8)
    dw CODE_grinder_main_hanging_spit_seeds    ;  $0A HangingMonkeySpittingSeeds ($1A9)
    dw CODE_grinder_main_death_pose            ;  $0C death-pose (shared)

DATA_grinder_airborne_ptr:                      ; Bank02:5377
    dw CODE_grinder_airborne_run_away          ;  $02 RunAwayMonkey
    dw CODE_grinder_airborne_watermelon        ;  $04 MonkeyWithWatermelon (RTS stub)
    dw CODE_grinder_airborne_hanging_noop      ;  $06 HangingMonkeyThrowing
    dw CODE_grinder_airborne_theif             ;  $08 TheifMonkey
    dw CODE_grinder_airborne_hanging_noop      ;  $0A HangingMonkeySpittingSeeds
    dw CODE_grinder_airborne_death_pose        ;  $0C death-pose airborne
```

The dispatch in `main_grinder_common` (Bank02:5283-5364) is:

```
main_grinder_common:
    ; ... engine prologue (palette / status / freeze checks) ...
    LDY.b $76,x                   ; high-level state byte
    BEQ.b .grounded               ; $76 == 0 = grounded
.airborne:
    ; airborne path
    LDA.w !EXRAM_YI_Level_NorSpr_YSpeedLo,x
    CMP.w #$FFC0
    BCC.b .checkLand
    LDA.w #$0004 : STA $7542,x    ; aerial timer
.checkLand:
    LDA.w #$0000 : STA $7402,x    ; airborne anim frame
    TXY
    LDX.w !EXRAM_YI_Level_NorSpr_GenericTable701900,y   ; variant byte
    JSR.w (DATA_grinder_airborne_ptr-$02,x)
    BRA.b .postDispatch

.grounded:
    TXY
    LDX.w !EXRAM_YI_Level_NorSpr_GenericTable701900,y   ; variant byte
    JSR.w (DATA_grinder_main_ptr-$02,x)
    ; ... post-dispatch land-detection ...
.postDispatch:
    JSR.w CODE_02B8C7              ; engine kill-by-tile check
    ; ... palette / animation cleanup ...
    RTL
```

The `-$02` offset on the dispatch table is intentional: the variant
byte is $02..$0A (each 2-byte step), and the table is indexed by
byte; the `-$02` shifts the table so variant $02 maps to the first
entry. This is a 1-byte-cheaper alternative to subtracting $02 from
the variant byte first.

`$76,x = 0` means grounded; non-zero (after a hit / kill / lunge)
means airborne. The death-pose at variant index $0C is reached by
**rewriting `$701900,x = $0C`** in the kill path (Bank02:5260) -- so
a Grinder that gets stomped or egg-hit loses its variant identity
and runs the shared death pose.

### 6.4 Per-variant grounded behaviour

The 5 variant-specific Main handlers (Bank02:5392-6700) share a lot
of helper code. Key per-variant traits:

**$1A5 RunAwayMonkey** (`CODE_grinder_main_run_away` Bank02:5533):
- Sub-state in `$18,x`: 0 = idle/wander, 1 = panic-flee, 2 = saw-Yoshi-flip.
- Watches for nearby alive watermelon ($7D36 link, sprite-ID
  matches $007): if so, grabs the watermelon by linking `$701978`
  on the watermelon's slot and switching to variant 4
  (`STA #$0004 : STA $701900,x`) -- the monkey **becomes a
  MonkeyWithWatermelon** mid-game. This is a runtime variant-
  morph.
- Otherwise, computes distance to Yoshi via `CODE_02B259`
  (squared-distance sum); if Yoshi within $80 units, faces away
  ($77C2 = $7400 XOR $02) and increments wander timer.

**$1A6 MonkeyWithWatermelon** (`CODE_grinder_main_watermelon`
Bank02:5938):
- Uses 19-entry `DATA_02B43C` / `DATA_02B44F` (frame/hold tables)
  for throw animation sequence.
- At frame index $22 (the throw-pose), plays `SoundID14_Gulp`
  ("preparing to spit").
- At frame index $23 (the actual launch), spawns a `$0107
  WatermelonSeed` projectile -- via `CODE_spawn_sprite_active`
  with directional offset from `DATA_02B466` and X-vel from
  `DATA_02B46A`. Emits `SoundID45_SpitSeed`. The seed is launched
  with `$7D38 = 1` and `$7A38 = 1` (alive-flagged).
- If no seed-slot available, falls through to standard cycle.

**$1A7 HangingMonkeyThrowingBombsNeedlenoses** (`CODE_grinder_main_hanging_throw`):
- Hangs from $7042's hang-attribute bits.
- Uses similar Y-velocity-driven 4-step pose cycle for drop.
- Drops projectile (bombs / needlenoses depending on level data).

**$1A8 TheifMonkey** (`CODE_grinder_main_theif`):
- On body-contact with Yoshi, drops `$7D36` link state to call
  `CODE_06C09A` (the standard Yoshi-loses-Baby-Mario routine).
- 4-second animation post-grab before the Toady-replacement ambush
  can spawn (handled by §5).

**$1A9 HangingMonkeySpittingSeeds** (`CODE_grinder_main_hanging_spit_seeds`):
- Climbing variant -- continually drops seeds while moving up/down
  the vine.
- Reuses the $1A6 spit-seed code path through shared
  `CODE_02AEA0`.

### 6.5 The death-pose shared handler

`CODE_grinder_main_death_pose` at Bank02:5395 uses a 19-entry
death animation:

```
DATA_02B030:    ; frame indices
    db $02,$01,$02,$01,$00,$16,$15,$14,$15,$14,$13,$14,$13,$12,$11
    ; ... 15 entries -- the death frame cycle

DATA_02B03F:    ; per-frame hold counts
    db $08,$08,$08,$08,$20,$06,$10,$04,$04,$40,$04,$04,$04,$04,$04
    db $FE,$FF,$FE,$FF,$FD,$FF,$03,$00,$02,$00,$02,$00
    ; ... continued, with negative values for bounce phase
```

The handler counts down `$7A38,x` from $10 (set in `CODE_02AE7D` by
the kill-init) using `$7AF8,x` as per-frame hold. At each frame
boundary, looks up `DATA_02B030-$01,$7A38,x` and `DATA_02B03F-$01,
$7A38,x` (the `-$01` offset is because index 0 means "we're done").

When `$7A38` underflows to 0, the slot is despawned via
`CODE_03A31E`. The bounce-phase (last 12 entries with negative
values) handles the in-air arc -- so the death pose includes a
visible "bounce" before settling.

The shared death-pose is reached from any variant via:
```
.killPath:
    LDA #$000C : STA $701900,x     ; rewrite variant -> death-pose
    LDA $7042,x : ORA #$0030 : STA $7042,x    ; alpha-blend in
    PLA                            ; (in some paths)
    RTS
```

After this, the very next `main_grinder_common` frame dispatches
through variant $0C, running the death animation. Variant byte
$0C also means the airborne dispatch goes to
`CODE_grinder_airborne_death_pose` -- the bouncing arc.

### 6.6 Helpers worth noting

**`CODE_02ADC1`** -- the terrain-probe helper (Bank02:5058). Wraps
SuperFX `FXCODE_0ACE2F` to test whether a tile at (X+offset, Y) is
"safe to escape into" -- specifically, looks for tiles that aren't
type $99 (which is the wall-or-pit marker). Returns carry-set on
match. Used by Init paths to pick left/right wander direction.

**`CODE_02AEA0`** -- the projectile-spawner (Bank02:5189). Spawns
target sprite $007 (Watermelon) and rigs back-pointer
`$701978,y = TXA` (parent slot index). Sets per-projectile state
(`$7A38 = $0400`, `$75E2 = $0400`). Used by $1A6 Init and the
runtime variant-morph in $1A5.

**`CODE_02B259`** -- distance-to-Yoshi helper (Bank02:5654).
Computes `|$7C16| + |$7C18|` (sum of abs differences in screen-
relative X and Y) and compares to $80 (the "Yoshi close" threshold).
Used by $1A5 to decide flee direction.

### 6.7 Cross-references

- `yi/Banks/Bank02.asm:4998-6700` -- the full Grinder family.
- `yi/Banks/Bank04.asm:60-237` -- $007 Watermelon (the projectile
  spawned by $1A6 + the runtime-morphed $1A5). See `docs/family-misc.md §2`
  for the Watermelon projectile family.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $1A5 / $1A6
  / $1A7 / $1A8 / $1A9, plus $007 / $107 WatermelonSeed projectile.
- `yi/Constants/SoundIDs.asm` -- `SoundID14_Gulp`,
  `SoundID45_SpitSeed`.
- `docs/family-misc.md §2 (Watermelon family)` -- the $007/$107
  projectile sprites that the spit/throw variants spawn.
- `docs/family-misc.md §5 (Toady family)` -- the ambush sequence
  that follows when a $1A8 ThiefMonkey successfully grabs Baby
  Mario (Toady carries Baby Mario off-screen).
- `docs/spritestateengine.md` -- the engine that runs
  `main_grinder_common` each frame.
- `yoshisisland-disassembly/disassembly/bank02.asm` --
  Raidenthequick descriptive labels: `init_grinder_runs_away`,
  `init_grinder_spits_seeds`, `init_seedy_sally`,
  `init_grinder_grabs_baby_mario`,
  `init_grinder_spits_seeds_climbing`, `main_grinder_common`.
  (The `init_grinder_grabs_baby_mario` label refers to $1A8
  ThiefMonkey -- the descriptive label matches the framework's
  `YI_NorSpr1A8_TheifMonkey` (sic) constant.)
- `ys_grinder0.asm` / `ys_enmy*.asm` -- parallel asm for the
  monkey-grinder family.

---

## 7. Bat family ($13D Dangling / $13E Flying)

Two cave-bat variants sharing the same fall + arc machinery. `$13D
DanglingFang` is the level-placed ceiling clinger -- it sits motionless
on a tile-mounted point, drops on Yoshi proximity, then resettles. `$13E
FlyingFang` is the runtime spawn-only variant produced by the Bat
Generator system; it never appears in level data directly. Both live in
`yi/Banks/Bank07.asm` lines 6044-6339, share four helper routines, and
use the same Init- and Main-level wind-up / fall / squeak SFX timing
constants.

### 7.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$13D` | `DanglingFang` | `init_fang_dangling` Bank07:6044 | `main_fang_dangling` Bank07:6053 | shared head-bop | Ceiling-clinging Cave Bat. 3-state cling -> fall -> recover. |
| `$13E` | `FlyingFang` | `CODE_init_fang_flying` Bank07:6240 | `main_fang_flying` Bank07:6276 | shared head-bop | Spawn-only variant from the Bat Generator. Descent-arc variant chosen from spawn-bit. |

Raidenthequick names the family "fang" rather than "bat" -- the cling
posture with the inverted teeth visual matches the in-game sprite art.
The framework's `Define_YI_NorSpr13D_DanglingFang` / `DanglingFang`
label preserves the cling reference.

### 7.2 Shared infrastructure

All four bat routines (`init_fang_dangling`, `main_fang_dangling`,
`CODE_init_fang_flying`, `main_fang_flying`) share these helpers:

- **`CODE_07B165`** (`Bank07:6194`) -- the per-frame SFX tick: every
  4 frames during the fall (`$7AF6 & $0003 == 0`) push
  `SoundID1B_MaceTick` to the audio queue. The "tick tick tick" wing-
  flap audio cue uses the MaceTick sample (same effect as the rotating
  mace spike-on-tether SFX -- shared sample, repurposed for bat-wing
  flap).
- **`CODE_07B177`** -- the trig-driven velocity setter: takes the
  current `$18,x` angle (8-bit-radians), looks up `DATA_sine_lut_8bit_radians`
  and `DATA_cosine_lut_8bit_radians`, then writes Y-speed = sin, X-speed
  = +/- cos (sign chosen from `$7400,x` via `DATA_07B07C = $FFFF,$0000`).
  The "INC" on the cos result is the standard 2's-complement negate-
  shortcut: `EOR #$FFFF / INC` = `NEG`.
- **`CODE_07B194`** -- the egg-hit / squish handler: if `$7D36` (hit-
  by-egg flag) is set, calls `CODE_07FC2F` (universal sprite-vs-sprite
  hit logic) and on hit jumps to `CODE_03A858` (despawn + score-pop +
  death effect).
- **`CODE_07B0F5`** -- the squeak-cycle helper (shared between `cling`,
  `fall`, and the flying main). Refreshes the 64-frame `$7AF6` SFX
  lockout, ticks the frame-counter table (`DATA_07B0C7 = 0,1,2,3,2,1`
  for the wing-flap animation), and on `$7A98 == 0` spawns an ambient
  audio puff (AmbSpr $1FC, the bat-wing flap visual effect).

### 7.3 $13D DanglingFang state machine

3-entry `DATA_fang_dangling_state_ptr` at Bank07:6070:

| State `$16,x` | Handler | Behavior |
|---|---|---|
| 0 (cling) | `CODE_07B080` Bank07:6079 | Poll Yoshi distance: if `|$7CD8 - $611E + $0020| >= 0` (Yoshi off-screen high) skip. Else check X-distance band `|$7CD6 - $611C + $0080| < $0100` (Yoshi within ~$80 pixels horizontally). If Yoshi inside the trigger box: set `$18,x = $0194` (start fall angle), pick fall speed from `DATA_07B0CD = $0003,$0001` indexed by sign of Y-speed, set 64-frame `$7AF6` timer, advance 2 states (`$16,x += 2`). |
| 1 (fall) | `CODE_07B0D1` Bank07:6120 | Increment fall angle `$18,x += 4` modulo $01FE. When `|$7CD8 - $611E + $0010| < 0` (bat passed level of Yoshi), pick recovery speed from `DATA_07B0CD`, advance to recover. Each tick: refresh SFX, animate wings (`$78,x` cycles 0..5 -> `DATA_07B0C7` -> `$7402` OAM-frame). Every $0C frames spawn AmbSpr $1FC (squeak visual). |
| 2 (recover) | `CODE_07B14A` Bank07:6178 | Same as fall but with a soft-return ascent: keeps incrementing angle until reaching the cling start position, then transitions back to state 0. The `$76,x = 1` flag during recover prevents repeat-trigger until the timer fully expires. |

Initial state (Init) sets `$7402 = $0004` -- the bat OAM frame for
"cling" (eyes open, wings folded). State $00 holds this static frame
until trigger.

### 7.4 $13E FlyingFang variants + state

`FlyingFang` has no per-state table; it runs `main_fang_flying`
directly which dispatches on `$7A36,x` (the BatGenerator-tracked
runtime flag). Init reads `$70E2 & $0010` low bit to pick one of 4
descent arcs from `DATA_07B1A6 = $FEA0, $0160, $0020, $FFE0`:

| Bit | Y-speed | X-acceleration (`DATA_07B1AE`) | Direction (`DATA_07B1B2`) |
|---|---|---|---|
| 0 | -$0160 (up) | $F800 (left-decel) | $FF80 (left) |
| 1 | $0160 (down) | $0800 (right-accel) | $0080 (right) |

So one bat ascends-and-decelerates-left, the other descends-and-
accelerates-right (the "swarm spreading out" effect).

The squish path (Init -> trigger -> fall -> AmbSpr puff) is identical
to $13D except for:
- On any-state egg-hit (`$7D38,x != 0`): set `$7A38,x = 1` (death
  flag), `$7542 = $0040` (16-pixel hitbox), `$75E2 = $FF00` (upward
  death velocity), `$75E0 = $0020` (death accel), `XSpeed = +/-$0200`
  (lateral spray, sign from $7221 facing), `$7D38 = 0` (clear).
- **Spawned-bat tracking**: `$7A36,x` is the "I'm spawned" marker. On
  off-screen detection (`CODE_07FC64` returns carry-clear), decrement
  `!RAM_YI_Level_NorSpr_SpawnedBatGeneratorBatsLo` (free up a Generator
  slot) before despawn. This is the load-balancer between the Generator
  spawn pool and active bats.
- **State decision**: `$7A38,x` (the death flag) takes precedence -- if
  set, only the post-hit fall is run; if clear, the squeak-cycle helper
  + the X-velocity refresh (XSpeed = +/-$0800 based on facing-vs-spawn-
  X comparison) drive the level flight.

### 7.5 Cross-references

- `yi/Banks/Bank07.asm:6044-6339` -- both bat handlers + the four
  shared helpers (CODE_07B165 / CODE_07B177 / CODE_07B194 / CODE_07B0F5).
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $13D / $13E.
- `yi/Constants/AmbientSpriteIDs.asm` -- `AmbSpr1FC` (bat-wing flap
  visual effect; spawned every $0C frames during the squeak cycle).
- `yi/Constants/SoundIDs.asm` -- `SoundID1B_MaceTick` (the wing-flap
  audio).
- `yi/Memory/SRAM_LevelState.asm` -- `!RAM_YI_Level_NorSpr_SpawnedBatGeneratorBatsLo`
  (the Generator slot counter that $13E decrements on despawn).
- `docs/spritestateengine.md` -- the engine that runs `main_fang_*`
  each frame.
- Bat Generator (the per-level spawner pumping out $13E instances) --
  search for the BatGeneratorBats counter writes; the generator sprite
  itself spawns into the level normally.

---

## 8. Pinball flippers ($13C Down / $144 L+R)

Two stationary pinball-table-themed platforms. `$13C
PinballDownFlippers` is a single down-pointing 2-paddle assembly; `$144
PinballLRFlippers` is the left- or right-pointing variant (the spawn
chooses one direction). Both stand on (or hang from) BG3 tile mounts,
both stomp-respond identically, and both render via the same SuperFX
helper. The platforms physically support Yoshi standing on them; on
head-bop ($7D36 set) the flipper retracts for 16 frames and flings
Yoshi upward at -$0140 to -$01C0 Y-speed.

### 8.1 ID table

| Sprite ID | Constant | Init handler | Main handler | OAM tile (rest/active) | Role |
|---|---|---|---|---|---|
| `$13C` | `PinballDownFlippers` | `init_flipper_downwards` Bank0D:3425 | `main_flipper_downwards` Bank0D:3438 | $04B4 / $0474 | BG3 down-pointing flipper pair. |
| `$144` | `PinballLRFlippers` (a.k.a. `RightOrLeftFlippers`) | `init_flipper_left_and_right` Bank0D:3816 | `main_flipper_left_and_right` Bank0D:3837 | $04B5 / $0475 | BG3 horizontal flipper (direction picked from spawn bit). |

The OAM-tile delta between rest and active is 8 frame slots (`$0040`
in 16-pixel-aligned tile space).

### 8.2 Shared infrastructure

Both flipper variants call `CODE_0D9C93` (Bank0D:3727), the **shared
platform setup**: writes 8 OAM tile rows (the wide flipper assembly)
into the per-slot OAM row registers. This is the same helper used by
all small bank-0D contraptions that need an inflate-on-stomp
animation.

Both run `CODE_0D9B13` after physics: the head-bop / collision
handler. The head-bop block does:

1. Check `$7D36,x` (head-bop flag). If clear, skip.
2. Compute Yoshi-vs-flipper Y delta. If Yoshi is below the rim
   (`$00 < $FFF7`), check if the flipper is moving down (`$7A38 < $FFE0`)
   -- if so, run the "punt" branch: clamp Yoshi's Y position to the
   flipper surface, play `SoundID1C_StompEnemy`, and if Yoshi's
   Y-velocity is downward ($60AA < $FF40), set `$7AF6 = $0004` (4-frame
   compression lock) + reset `$78,x = 0` and `$701900 = $0004` (spring-
   release flag).
3. Else: enter the **stomp-press** branch. Set `$18,x = 2` (pressed
   state), reset `$78,x = 0`, play `SoundID0E_ShellHit4`, set the 16-
   frame `$7AF6` recovery timer.
4. Run `FXCODE_099011` (the sprite-vs-sprite collision query) to find
   any sprite that's standing on the flipper. For each such sprite,
   either punt it upward (if it's a melon / iced melon / eggshell:
   `$006, $018, $022-$02B`) or kill it (otherwise: `$0091` Toady
   excepted -- toadies fall straight through flippers).

The `$144` flipper has an additional preset in Init: `$7A36,x =
DATA_0D9D2A,y` where Y is `($70E2 & $0010) >> 3` -- this selects
`$0080` (right-pointing) or `$FF80` (left-pointing). The 32-pixel
spawn-X-grid bit makes one variant a "right flipper" and the other a
"left flipper".

### 8.3 Stomp / flip animation

The 16-frame stomp animation is driven entirely by `$7AF6,x`. On
expiry, the flipper resets to rest (OAM tile $04B4 / $04B5). During
the compression window (`$18,x = 2`), the OAM tile flips to the
active variant ($0474 / $0475 -- 8 OAM rows showing the upraised
paddle). The visual is a 1-tick compress -> 16-tick rebound -> 0-tick
release; subjectively a snappy flip-up motion.

A pun-worthy detail: the head-bop sound `SoundID0E_ShellHit4` is the
same SFX as Koopa shells. Repurposed for flipper retract -- both
sound like "metallic clack".

### 8.4 Cross-references

- `yi/Banks/Bank0D.asm:3422-3811` -- $13C handlers + shared
  CODE_0D9A40 SuperFX setup.
- `yi/Banks/Bank0D.asm:3813-3970` -- $144 handlers (mirror of $13C).
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $13C / $144.
- `yi/Constants/SoundIDs.asm` -- `SoundID0E_ShellHit4` (stomp),
  `SoundID1C_StompEnemy` (punt).
- `docs/family-platforms.md` -- the broader platforms family. Flippers
  count as static platforms with a head-bop reaction; the platforms
  doc covers the standard rideable platforms ($1B4 etc.).

---

## 9. POW / Switches ($097 POW Block / $09D Red POW Switch)

Two switch sprites. **$097 POWBlock** is the screen-wide enemy-clear
button -- hit with an egg or head-bopped, it triggers a global
`$61C6 = $20` enemy-clear pulse that despawns all on-screen sprites
except those flagged immune. **$09D RedSwitch** is the red palette-
swap timer -- stomped, it sets `!RAM_YI_Level_RedSwitchTimer = $0280`
(640 frames = ~10.7 sec at 60 Hz), locks player input via `PlayerState02_InCutscene`,
and replaces selected BG tiles with collectibles during the window.

### 9.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$097` | `POWBlock` | `init_POW` Bank05:15769 | `main_pow_block` Bank05:15794 | shared head-bop | Screen-wide enemy clear when hit by egg/head-bop. |
| `$09D` | `RedSwitch` | `init_red_pow_switch` Bank0E:7009 | `main_red_pow_switch` Bank0E:7034 | shared head-bop | Stompable button revealing red-coin / hidden-block area during timer. |

### 9.2 $097 POWBlock state machine

3-entry `DATA_pow_block_state_ptr` at Bank05:15788 (indexed by
`$76,x`):

| State | Handler | Behavior |
|---|---|---|
| 0 (idle) | `CODE_0580C2` (shared GSU delta-facing stub) | Standby. Init has already drawn the POW block. |
| 1 (detonate) | `CODE_05F6BF` Bank05:15896 | Inflate animation. Compares current `$7A36,x` scale against `DATA_05F5A7,y` where `y = $0E25` (some per-level counter). Increments scale until reaching the target, then advances. |
| 2 (post-detonate) | `CODE_0580C2` (shared stub) | Cleanup. Triggers the kill via the FX hit-loop ($05F629). |

The detonation path itself sits inside `main_pow_block`'s outer body
(not the state dispatch):

```
CODE_05F629:
  CPY.b #$04 (hit by 4th sprite kind?)
  ... LDA #$0020 / STA $61C6   ; arms screen-wide enemy clear
  JSL CODE_0294B4              ; kicks off the engine detonation routine
  ... SoundID1F_HitHead
  INC $0E25 INC $0E25          ; bump POW counter (max 3 POWs per level)
  CPY #$06 BNE                 ; "all 3 POWs used"?
  ... LDA #!Define_YI_AmbSpr1D4 / spawn cloud puff
```

So **$0E25 caps POW usage at 3 per level**. The 4th POW is no-op (Init
returns via `CODE_03A31E` early). `DATA_05F5A7 = $0100,$00A0,$0060` --
the inflate-target sizes drop by ~$40 each time, so the 1st POW is
fully visible, the 2nd is smaller, the 3rd is tiny. After the 3rd POW
detonates, `$0E25 = 6` so subsequent POW spawns are ignored.

### 9.3 $09D RedSwitch state machine

4-entry `DATA_0EB5F9` at Bank0E:7025 (indexed by `$76,x` ASL):

| State | Handler | Behavior |
|---|---|---|
| 0 (idle) | `CODE_0E8000` (shared unused-stub) | Standby. Player can stand on it. |
| 1 (wait near player) | `CODE_0EB6FF` Bank0E:7150 | Yoshi stomped the switch (`$7860 & $0001` ground-flag set). Inflate the press visually: shrink `$7A38` from $40 toward $40, scale `$7A36` from current toward $0180. Sets `$7042 |= $0004` (color-bit), zeroes the standard timer, pushes `SoundID32_HitMessageBox`. |
| 2 (pressed) | `CODE_0EB76D` Bank0E:7203 | Continue the press animation. Once `$7A38` clamps at $0100 and `$7A36` reaches $0100, spawn AmbSpr $1E7 (button-press puff), set `!RAM_YI_Level_RedSwitchTimer = $0280`, unlock player input (`PlayerState00_Normal`), set Yoshi's Y-velocity to $FA00 (small upward bounce), and arm `$74A2 = $00FF` (palette-swap signal). Sets the X-direction velocity from $701901 sign. Advances to state 3. |
| 3 (expire/restore) | `CODE_0EB807` Bank0E:7271 | Tick down the global RedSwitchTimer. While running, push `SoundID7E_SwitchTicking` every 64 frames (or `SoundID7F` -- "faster ticking" -- if timer is < $00C0). On timer-zero, clear $7E08 bit $0008 (the "switch active" flag) and despawn. |

Two interesting details:

1. **The press cutscene is genuinely interactive-blocked.** State 1 sets
   `PlayerState02_InCutscene` and increments `!EXRAM_YI_Level_FreezeSpritesFlagLo`
   + `!EXRAM_YI_Level_FreezeYoshiFlagLo`. State 2 unfreezes everything
   ($60AA, $61B4, frozen flags). The "press the switch" gesture is a
   ~30-frame mini-cutscene where the player and other sprites are
   actively halted -- this is rare in YI (the door cutscene at $001 is
   the other one).

2. **Two-stage ticking sound.** `SoundID7E_SwitchTicking` for the first
   half of the timer; if `RedSwitchTimer < $00C0` (last ~192 frames =
   ~3.2 sec), switch to `SoundID7F` (the higher-pitched "urgent"
   variant). The transition is one frame -- no fade.

### 9.4 Cross-references

- `yi/Banks/Bank05.asm:15769-15911` -- $097 POW Block (full).
- `yi/Banks/Bank0E.asm:7009-7297` -- $09D Red Switch (full).
- `yi/Constants/SoundIDs.asm` -- `SoundID1F_HitHead`,
  `SoundID32_HitMessageBox`, `SoundID33_StepOnNumberPlatform`,
  `SoundID7E_SwitchTicking`, `SoundID7F`.
- `yi/Memory/SRAM_LevelState.asm` -- `RedSwitchTimer` (the $0280-tick
  global countdown).
- `yi/Memory/WRAM_*.asm` -- `$0E25` (per-level POW-block counter --
  caps at 3 detonations), `$7E08` ($0008 = "switch active" bit).

---

## 10. Crates ($003 CrateWithKey / $10E CrateWith6Stars)

Two wooden crate sprites sharing the same Init + Main + 7-state
dispatch table. The only differences:

1. **Payload on stomp** -- $003 spawns the world Key sprite ($027); $10E
   spawns 6 Star pickups via the `CODE_0D8ED7` chain.
2. **Tilemap variant** -- the BG1 tileset (3 = jungle, 13 = jungle-like)
   triggers a Y-nudge in Init (+$0008) and selects a different stomp
   hitbox via `$19,x = $04`. Other tilesets use the default.

### 10.1 ID table

| Sprite ID | Constant | Init handler | Main handler | Stomp payload | Role |
|---|---|---|---|---|---|
| `$003` | `CrateWithKey` | `init_crate` Bank0D:1905 | `main_crate` Bank0D:1958 | $027 Key | Stomp -> key drop. Used in worlds with locked-door progression. |
| `$10E` | `CrateWith6Stars` | shared `init_crate` | shared `main_crate` | 6 x Star | Stomp -> 6 stars (timer refill). Bonus crate. |

Both inits are at the same address (Bank0D:1905) -- the framework
labels both YI_NorSpr003_CrateWithKey_Init AND
YI_NorSpr10E_CrateWith6Stars_Init at the same `init_crate` body. The
in-Main differentiation (which payload to spawn) happens via:
```
CMP.w #!Define_YI_NorSpr10E_CrateWith6Stars
BNE.b ...crate-with-key path
```
at Bank0D:2362.

### 10.2 Shared 7-state state machine

`DATA_0D8EB0` at Bank0D:1946 (indexed by `$76,x` ASL):

| State | Handler | Behavior |
|---|---|---|
| 0 (idle) | `CODE_0D8000` (engine entry) | Standby. Crate visible, accepts head-bop. |
| 1 (pre-stomp peek) | `CODE_0D917B` Bank0D:2307 | Reduce $7A36 by $0010 each frame; cap at $00F0. Stops at the bouncy floor of the stomp animation. |
| 2 (stomp wind-up) | `CODE_0D918F` Bank0D:2318 | Increment $7A36 by $0008 each frame; cap at $00E0. |
| 3 (stomp expand) | `CODE_0D91A3` Bank0D:2330 | Increment $7A36 by $0004 each frame; clamp at $0100, then reset state to 0. |
| 4 (post-egg-hit bounce) | `CODE_0D91B7` Bank0D:2341 | Drift down by `$7A38,x` velocity over 1 frame; when displacement reaches $0080, dispatch to the per-payload bonus spawner via `CODE_0D9236` -> either Key drop (if $003) or 6-star chain (if $10E). |
| 5 | `CODE_0D93BE` | Defeat aftermath (one of the unused-engine state slots). |
| 6 (despawn-after-payload) | `CODE_0D93C9` | Wait 60 frames ($7A96 = $0060) then JSL CODE_03A31E. |

States 1, 2, 3 form the stomp-bounce cycle: shrink -> bounce -> snap-
back. Each $7A36 delta is ~$00X per frame so the visual is ~6-8 frames
total per state (~24 frames for the whole cycle).

### 10.3 Cross-references

- `yi/Banks/Bank0D.asm:1900-2376` -- shared Init + Main + the 7-state
  dispatch.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $003 / $10E.
- `yi/Constants/NormalSpriteIDs.asm` -- $027 Key (the world key
  spawned by the $003 variant).
- The 6-star chain spawner `CODE_0D8ED7` -- spawns sprite $010E into
  the slot, sets `$76 = 6`, `$74A2 = $FFFF`, `$7040 = $2081` -- the
  star-spray-falloff animation. Each star spawn pushes a new sprite
  into a fresh slot at offset position; the chain itself uses
  `CODE_03A31E` to free the originating crate slot once done.

---

## 11. Springs / Balls ($06C Large / $06F Regular / $148 Large alt)

Three spring-ball platforms (Bank05:466-722). All three share one Main
body (`main_spring_ball` at Bank05:544 / `main_large_spring_ball` at
Bank05:549) and the same compression/launch helper
(`CODE_05837E` Bank05:589). The variant distinction is purely an
Init-side hitbox/visual selection -- the Main code dispatches by sprite
ID for one small physics-helper choice.

### 11.1 ID table

| Sprite ID | Constant | Init handler | Main handler | bbox | Role |
|---|---|---|---|---|---|
| `$06C` | `LargeSpringBall` | `init_large_spring_ball` Bank05:480 | `main_large_spring_ball` Bank05:549 | $7BB6=$0C / $7BB8=$0C | Wide-tile bbox + platform setup via `CODE_02A007`. Compresses lower than regular, launches higher. |
| `$06F` | `SpringBall` | `init_spring_ball` Bank05:516 | `main_spring_ball` Bank05:544 | $7BB6=$04 | Regular 1-tile springy platform. Compress -> spring. |
| `$148` | `LargeSpringBallAlt` (variant 2) | shared `init_large_spring_ball` (Bank05:481) | shared `main_large_spring_ball` (Bank05:550) | $7BB6=$0C / $7BB8=$0C | **Functional duplicate of $06C.** Same Init, same Main body. |

### 11.2 Init differences

`init_large_spring_ball` (Bank05:480) tests `$7722 BPL` -- this is the
"first-frame" sentinel that asar sets to $FFFF on initial spawn. On the
first frame, it sets up: `$7402 = 1` (init flag), `$701900 = $0100`
(generic placeholder), `$7720 = $FFF8` (slope offset), zero
`$7B58` (some platform-collision flag), $7BB6 / $7BB8 = $0C (12-pixel
bbox both axes), then calls `CODE_0582FD` with `Y = 2` (large-variant
path).

`init_spring_ball` (Bank05:516) goes straight into `CODE_0582FD` with
`Y = 0` (regular-variant path). Both fall through to `CODE_05851F` (the
SuperFX-render setup that draws the spring graphics).

The shared body at `CODE_0582FD`:
- `$7BB6 = $0004` (4-pixel bbox X)
- `$7A36 = $0100` (compression magnitude / scale at rest)
- `$7400 = 0` (facing-clear)
- `$7A38 = $7BB8 + $6122 + $6112` (compute the bouncy-rim Y in screen
  space)
- Calls `CODE_05851F` (the SuperFX-render setup)

### 11.3 Main + the $148 variant-conditional

Main's per-frame body for $06F is at Bank05:544. The dispatch:

```
LDY $7402,x         ; check "init complete" flag
BEQ skip_gravity    ; not init, skip
JSL CODE_03AA52     ; standard gravity-physics step
```

So the $06F path skips gravity entirely on its first frame; the large
variants always run it.

Then the body checks sprite ID:
```
LDY #$00
LDA $7BD4 (SpriteID)
CMP #$06F  BEQ
INY INY
CMP #$148  BNE      ; if not $148 either, jump past the variant block
... $148-only block ...
```

The $148-only block (Bank05:563): if `$75E0 & $0001` is set (the
"hold compress until release" flag, used by some platforms), gate
based on `$75E0` mod and the spawn-X comparison. Then clear
`$7040 & $FFF3` (clear bits 2-3 of the OAM control register -- the
"slide" indicator).

After that branch, the body is identical for all three: compression-
launch helper `CODE_05837E` -> SuperFX-render `CODE_05847C` -> save
compression for next frame in `CODE_05851F`.

### 11.4 The compress / launch math

`CODE_05837E` runs the compression-physics. Key block (Bank05:611+):
- `$60AA` = current Yoshi Y-velocity
- `$60AA >> 2` (divide by 4) = base launch boost
- For $148-only: extra `>> 1` (divide by 2) on top of that
- `+= $0100` (base launch boost)
- Clamp at `$01C0` (max launch boost)
- Write back to Yoshi via `FXCODE_0B86BF`

So **$148 launches Yoshi ~50% lower than $06F at equal compress.** Both
launch higher than $06C (which has the largest compression range).
This is the player-perceivable difference: $06F is the standard 1-tile
spring, $06C is the 4-tile spring that bounces higher, and $148
launches notably less than $06F because its boost is halved.

Why $148 exists as a separate slot if it's "Large" but launches lower?
Best guess: $148 is the **alternate large-variant for use in
non-standard contexts** -- placed by level data where the hitbox needs
to be 4-tile but the launch needs to be subdued (e.g. inside a tight
vertical shaft). Without the lower launch, Yoshi would over-shoot.
[LABEL-LIKELY-WRONG candidate: the name "LargeSpringBall" for $148 is
misleading -- it should be something like "LargeSpringBallSoft" or
"DampedLargeSpringBall".]

### 11.5 Cross-references

- `yi/Banks/Bank05.asm:466-722` -- full Spring Ball family.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $06C, $06F, $148.
- `docs/family-platforms.md` -- other stationary platforms.

---

## 12. Eggo-Dil cluster ($0EE Body / $0EF Face / $0F0 Petal)

The eyeball-flower enemy is a 3-sprite cooperative: a stationary **body
master** ($0EE) that spawns the **face child** ($0EF), which in turn
spawns **8 orbiting petals** ($0F0). The body is single-instance per
level (enforced via `$0EDF` global flag); when the face is defeated, the
body + all 8 petals despawn together via the same flag.

The whole cluster lives in `yi/Banks/Bank05.asm` lines 7892-8537 in one
contiguous block.

### 12.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$0EE` | `EggoDil` | `init_eggo_dil` Bank05:7899 | `main_eggo_dil` Bank05:7929 | (passive) | Stationary body / master. Single-instance via `$0EDF` flag. Spawns the face. |
| `$0EF` | `EggoDilFace` | `init_eggo_dil_face` Bank05:7950 | `main_eggo_dil_face` Bank05:7966 | head-bop hit | The visible flower face. 5-state idle/emerge/hop-shake/defeat machine. |
| `$0F0` | `EggoDilPetal` | `init_eggo_dil_petal` Bank05:8478 | `main_eggo_dil_petal` Bank05:8485 | passes Yoshi | 8 orbiting petal-children. Pierce-on-touch (damage Yoshi). |

### 12.2 Body $0EE -- single-instance enforcement + face spawn

`init_eggo_dil` (Bank05:7899) does:

1. **Single-instance check**: `LDY $0EDF; BEQ ok` -- if `$0EDF` is
   non-zero, the body has already been spawned in this level (or is
   mid-defeat). The Init then **walks the petals array**
   (`$0EE1[y]` for `y = 8 downTo 0 step -2`) and writes `$FFFF` into
   `!EXRAM_YI_Level_NorSpr_GenericTable701902,y` for each live petal --
   this is the despawn signal each petal checks against. Sets each
   `$0EE1[y] = $FFFF` to clear the orbit-pool.
2. **Else**: increment `$0EDF`, then run the 9-petal cleanup loop
   (same as above) -- this is the **shared "kill all orbital children"
   primitive** that runs on either re-spawn-attempt OR on initial spawn.

`main_eggo_dil` (Bank05:7929) per-frame:
1. Run gravity (`CODE_03AF23`).
2. If `$18,x == 0` (haven't spawned face yet), spawn `$00EF` via
   `CODE_spawn_sprite_init`, copy XY into the face, store the face's
   slot in `$0EDD` (the body's "child slot reference"), set `$18,x = 1`
   (face spawned).
3. RTL.

### 12.3 Face $0EF -- the actual enemy + 5-state machine

`init_eggo_dil_face` runs `CODE_05BBD5` which is the SuperFX-render
setup ($7A36 magnitude = $0100 scale, FXDATA `FXDATA_550000+$0060`).

`main_eggo_dil_face` per-frame (Bank05:7966):
1. Run SuperFX scale via `CODE_05BA36`.
2. Check petal-defeat counter `CODE_05BB09`: if `$61C6 != 0` (screen-
   clear pulse) OR `$18,x != 0` (defeat triggered) AND `$0EEB != 0`
   (orbital-angle is set), iterate the 9 petal slots and on each live
   one apply the **explosion-spawn velocity from a SuperFX angle table**.
3. Then run gravity, check the level-clear flag (`$0EDF BPL`), and on
   active dispatch to one of the 5 states via `DATA_eggo_dil_face_state_ptr`:

| State `$76,x` | Handler | Behavior |
|---|---|---|
| 0 (idle) | `CODE_05BC14` Bank05:8217 | Wait for trigger. Lockout-timer + petal-spawn loop. Inflate the body from $00E0 -> $0100 in $0010 steps. Once at $0100 + `$18,x = 0`: try to spawn 5 petal sprites (`$00F0`) with offsets `+$0010y, +$0008x`. Stash each spawn slot in `$0EDF,y` (the petals array). Sets `$701900 = $0003` (orbital radius?), zeroes `$0EEB`, advances to state 1. |
| 1 (emerge) | `CODE_05BCBE` Bank05:8311 | Per-frame inflate: `$701900 += 1` mod $0014. At iteration $14 (=20 frames after emerge start), pick a 1-of-4 sub-anim (`$10 & $0003`) into `$16,x = 5+sub`. Sets $7A96 = $0020, $7A98 = $0030 (lockout timers). Advance to state 2. |
| 2 (hop-shake) | `CODE_05BCE8` Bank05:8332 | Idle hop-cycle. Each tick: if `$7A98 == 0`, decrement `$16,x` (sub-anim countdown). If `$16,x` hits -1, refresh + arm `!EXRAM_YI_Level_NorSpr_GenericTable7019D6` (the player-bumped flag). Else compute jitter: `$7A38 += $0008 * ($16 & 1)` (snap-shake). Also rotates `$0EEB += $0004` mod $01FE (the orbital angle progresses). |
| 3 (post-defeat) | `CODE_05BD3E` Bank05:8378 | Death scale-spiral. Spawns AmbSpr $1E8 (defeat puff) at face position. Then on `$76 != 4`, iterates the 9 petal slots and applies launch velocities via FXCODE_0B8595 (the angle-table launch helper). Despawns face slot. |
| 4 (post-defeat shared) | `CODE_05BD3E` | Re-uses state 3 handler. Different `$76,x` is the "in-progress despawn-with-petals-still-spawned" path. |

### 12.4 Petal $0F0 -- the orbital sprite

`init_eggo_dil_petal` is a one-instruction `RTL` -- petals get their
state preset by the face at spawn time (`$0EDF,y = TXA` and
`$701902,y = $0010` for orbital index).

`main_eggo_dil_petal` (Bank05:8485):
1. Check stomp/edge: if `$7D38,x` (egg-hit), call `CODE_05BE5A`
   (orbit-clear helper) which writes `$0EDF[y] = $FFFF` (parent's
   array slot), then despawns. Same on engine-kill (`CurrentStatus`
   == $10).
2. Check parent-alive: if `$0EDF BPL` (parent face is alive), gravity-
   step + Yoshi-collide check. If Yoshi hit (`$7D36 != 0`), JML to
   `CODE_0DC0F0` (the standard sprite-hits-Yoshi-with-damage handler).
3. Else (parent face is dead or this is an orphan petal): drift via
   stored XSpeed/YSpeed, finally call `CODE_05BE5A` + `CODE_03A5B7`
   (despawn-on-edge).

The orbital-update is **NOT** in the petal's Main -- it's in the face's
Main (`CODE_05BB75`). Each frame the face computes per-petal positions
from `$0EEB` (the master orbital angle) + per-petal phase offsets
(`+$0066 mod $01FE` between successive petals -- about 60 degrees =
2pi/8 in 8-bit-radians, giving an 8-way symmetric orbit). The face
writes the resulting X,Y into each petal's `$70E2,$7182` directly. So
petals are **kinematically slaved** to the face's orbital angle.

### 12.5 Cross-references

- `yi/Banks/Bank05.asm:7892-8537` -- the full Eggo-Dil family.
- `yi/Memory/WRAM_Buffers.asm` -- `$0EDF` (single-instance flag),
  `$0EDD` (body's stored face-slot), `$0EE1[y]` for y=0..8 step 2
  (the 9-element petal-slot array, of which 8 are typically used),
  `$0EEB` (the orbital master angle, 8-bit-radian).
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $0EE / $0EF / $0F0.
- `yi/Constants/AmbientSpriteIDs.asm` -- `AmbSpr1E8` (face-defeat
  puff).
- `docs/spritestateengine.md` -- the engine that runs the per-sprite
  main / Init dispatchers.

---

## 13. Insects + small fauna ($152 Flutter / $182 Dragonfly / $183 Butterfly / $191 Sparrow)

Four ambient airborne creatures. Three are pure background-detail
(visible-only, no damage / no interaction beyond being scary if eaten):
$182 Dragonfly, $183 Butterfly, $191 Sparrow. The fourth, $152
Flutter, is a fully-fledged enemy with a 3-state dive-bomb machine.

Despite the four being grouped here as "insects" they each live in a
different bank and have **no shared infrastructure** -- they share
neither hitbox setup, nor render path, nor state engine. The grouping
is taxonomic only.

### 13.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$152` | `Flutter` | `init_flutter` Bank07:7469 | `main_flutter` Bank07:7502 | shared head-bop | The big caterpillar/butterfly enemy. 3-state fly / dive / cling-recover. Drops winged-shield on stomp. |
| `$182` | `Dragonfly` | `init_dragonfly` Bank0F:1389 | `main_dragonfly` Bank0F:1412 | ambient (no damage) | Ambient airborne. Figure-8 hover pattern. |
| `$183` | `Butterfly` | `init_butterfly` Bank0F:1489 | `main_butterfly` Bank0F:1535 | ambient (no damage) | Ambient airborne. 4 random sub-pattern start positions. |
| `$191` | `Sparrow` / `Bird` | `init_sparrow` Bank0F:2124 | `main_sparrow` Bank0F:2141 | ambient (no damage; flies away on proximity) | Ambient bird. 2-state idle / panic-fly. |

### 13.2 $152 Flutter -- the real enemy

`init_flutter` (Bank07:7469) sets up:
- X-velocity from `$7400,x` (facing) -> `DATA_07BB14 = $FF80, $0080`
  (-/+$0080)
- Y-anchor: stashes spawn Y in `$18,x`; bumps actual Y by
  `DATA_07BB18 = $FFE0, $0020` (-/+$0020) based on `$70E2 & $0010` --
  so the bug spawns offset from level data by 32 pixels in the chosen
  direction
- Y-velocity (`$75E2 = +/-$0800` from same bit)
- $7A96 = $0004 (4-frame state tick)
- $76 = $0003 (initial sub-state)
- $7402 = `DATA_07BB8A[3] = 0` (frame 0 OAM tile)

`main_flutter` (Bank07:7502) per-frame:
1. If `$7D38,x` (egg-hit flag) set, toggle OAM color via `$6FA0 ORA
   $0200`.
2. Call shared `CODE_07BBC9` (the head-bop / egg-hit / nearby-enemy-
   hit handler -- big router).
3. Dispatch on `$16,x` to one of the 3 state handlers:

| State | Handler | Behavior |
|---|---|---|
| 0 (fly) | `CODE_07BB8E` Bank07:7528 | Hover with sine-wave Y. Each $0004 frame: cycle `$76,x` through 3, 2, 1, 0 (mod 4) and set the OAM frame from `DATA_07BB8A[$76]`. Track Y vs anchor `$18,x` to choose `$75E2 = +/-$0800` (climb/dive). |
| 1 (dive) | `CODE_07BC9E` Bank07:7649 | Yoshi-targeted dive. Tracks X-distance and inverts on contact; stomp-bounce-on-Yoshi resolution. |
| 2 (cling-recover) | `CODE_07BD21` | Brief settle, then back to fly. |

The most interesting bit: **`CODE_07BBC9`** is the head-bop handler.
On Yoshi-stomp, it spawns AmbSpr $202 (the "winged shield" pickup
projectile) at the Flutter's death position with `XSpeed =
DATA_07BBC5,y = $FF00 or $0100` (left or right based on facing) and
`YSpeed = $FE00` (upward). This is the **only sprite in the family
that drops a usable pickup** -- the others can be eaten but yield only
the standard Fuzzy-cloud effect.

### 13.3 $182 Dragonfly -- the figure-8 hoverer

`init_dragonfly` (Bank0F:1389) seeds:
- `$7A96 = 2` (2-frame anim tick)
- `$18,x = $70E2` (stash spawn X for figure-8 reference)
- `$7400 = ($70E2 & $0010) XOR $0002, >> 3` (facing-derived parity)
- `$16,x = DATA_0F89F5[Y] = $0000 or $0008` (the per-pattern phase
  offset into the figure-8 LUT)

`main_dragonfly` (Bank0F:1412) per-frame:
1. Run gravity.
2. Call `CODE_0F8A33` -- the figure-8 step. Reads
   `DATA_0F89E5[$16,x]` (16-entry signed X-offset LUT covering one
   horizontal cycle), adds to anchor X, subtracts current X, scales
   `<< 5` (5 ASLs = multiply by 32) -> XSpeed. Each anim tick advance
   `$16 += 2` mod $0E. On reaching frame 4 or 12 of the cycle, flip
   facing (`$7400 ^= 2`).
3. Cycle `$7402 ^= 1` (alternate OAM frame for wing-flap).

The LUT `DATA_0F89E5` was at Bank0F:1380 -- 8 entries of
$FFF0..$0020,$0010,$0000 (a sinusoidal X-displacement). With the `<<5`
scale, the dragonfly's velocity range is ~+/-$0400/frame, giving a
gentle hover motion that traces a horizontal figure-8.

### 13.4 $183 Butterfly -- 4-pattern random start

`init_butterfly` (Bank0F:1489) is the most randomized of the four:
- Reads `$10` (free-running master timer, low 2 bits) -> Y = 0..3
- ORs `$7042 |= DATA_0F8A7B[Y]` -- sets the OAM-frame variant byte
  (picks one of 4 palette / animation sub-patterns: $0000, $0002,
  $0004, $0008)
- Stashes spawn X in `$18,x`
- Picks facing from `$70E2 & $0010`
- Sets X = X + `DATA_0F8A83,y` (-/+$0020 X-offset)
- Sets Y = anchor + `DATA_0F8A87,y` (-/+$0008 Y-offset, also stashed
  in `$76,x` as the anchor)
- XSpeed = `DATA_0F8A8B,y` = -/+$0040 (slow horizontal drift)
- $7A98 = $0100 (256-frame direction-flip timer)
- YSpeed = `DATA_0F8A8F,y` = -/+$0800

`main_butterfly` (Bank0F:1535) per-frame:
1. Gravity.
2. Every $0004 frames toggle `$7402 ^= 1` (wing-flap).
3. On `$7A98 == 0`, flip both facing (`$7400 ^= 2`) and XSpeed
   (`DATA_0F8A8B,y` retrieved); refresh $7A98 = $0100 for next half-
   cycle.
4. Y-direction tracking: compare current Y to anchor (`$76,x`); pick
   YSpeed from `DATA_0F8A8F = $F800, $0800` based on the comparison
   (climb if below anchor, dive if above) -- this creates a vertical
   sinusoid superimposed on the X drift.

So the butterfly traces a soft horizontal lazy-loop, with a 256-frame
period and a Y-amplitude of ~$0010 px. The 4 sub-patterns randomize
the starting phase.

### 13.5 $191 Sparrow / Bird -- 2-state panic

`init_sparrow` (Bank0F:2124) is minimal:
- Reads `$10 & 0003` (random palette pick), shifts left
- ORs `$7042 |= DATA_0F8F4B[Y]` -- 4 palette variants from
  `DATA_0F8F4B = $0000, $0002, $0004, $0008`

That's it. No velocity, no anchor -- the sparrow doesn't move on Init.

`main_sparrow` (Bank0F:2141) dispatches on `$16,x`:

| State | Handler | Behavior |
|---|---|---|
| 0 (idle) | `CODE_0F8F92` Bank0F:2165 | Static perch. Calls `FXCODE_098F33` (per-frame SuperFX collision query -- finds the sprite slot of any non-Yoshi sprite within range). If a sprite is found within `$40 x $40` box around the sparrow OR Yoshi is within range, panic: pick XSpeed from `DATA_0F8F76 = $FD00..$0300` (8 random angles), YSpeed = $FE00 (upward), clear ground flags + push `SoundID75_LitterMouserSqueak`. Advance to state 1. |
| 1 (panic-fly) | `CODE_0F90A8` | Fly-away animation cycle. Eventually drops off-screen. |

The SFX is `SoundID75_LitterMouserSqueak` -- this is the same sound
as Little Mouser's squeak (one sample serves both -- yet another YI
sample-reuse). The mouser/sparrow common-startle sound matches the
"small surprised animal" trope.

### 13.6 Cross-references

- `yi/Banks/Bank07.asm:7460-7647` -- $152 Flutter (full).
- `yi/Banks/Bank0F.asm:1378-1568` -- $182 Dragonfly + $183 Butterfly.
- `yi/Banks/Bank0F.asm:2104-2237` -- $191 Sparrow.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $152 / $182 / $183 / $191.
- `yi/Constants/AmbientSpriteIDs.asm` -- `AmbSpr202` (Flutter's
  winged-shield drop on stomp).
- `yi/Constants/SoundIDs.asm` -- `SoundID75_LitterMouserSqueak`
  (Sparrow's panic + Mouser's bell-ringer; same sample).

---

## 14. Oddballs (one-paragraph entries)

Single-sprite enemies that don't fit into any larger family. Each
entry is a compact paragraph -- spawn source, per-frame mechanics, any
distinctive twist. Where a sprite shares Init+Main with another, the
sharing is documented under one entry and cross-referenced from the
other.

### 14.1 $00B3 Fuzzy Fart (`init_unused_rtl_stub` Bank03:2732 / `main_fuzzy_wind` Bank03:4205)

The drifting cloud released after Yoshi swallows a Fuzzy ($129). Init
is the **shared no-op RTL stub** -- the same address that the doc
labels `init_unused_rtl_stub`, used by ~200 sprites that need no Init
work. Main waits for the three engine freeze flags (FreezeSpritesFlag,
`TouchedFuzzyMosaicTimerLo`, `ItemBeingUsed`) to all be clear, then on
sprite-touched-by-Yoshi (`$7D36`) kills the touched sprite via
`CODE_03B595` (the standard sprite-killer). Self-despawns when
`$7A96` timer expires. The Fart inherits the spit-velocity from the
Fuzzy that spawned it, so a Fuzzy swallowed mid-drift produces a Fart
moving the same direction.

### 14.2 $0129 Fuzzy (`init_fuzzy` Bank03:15244 / `main_fuzzy` Bank03:15260)

The floating black pollen ball; if Yoshi eats it, causes the famous
mosaic-intoxication effect (full-screen color-cycle wobble for ~10
seconds). Init seeds Y-speed `$FF40` (upward drift) and X-speed from
the per-variant table `DATA_03F57A` indexed by `$7400`. Main applies
physics and on swallow (`$7D38`) sets
`!RAM_YI_Level_TouchedFuzzyMosaicTimerLo` to start the mosaic effect.
The sine-wave drift is bookkept via `$18,x` as the Y-anchor and `$76,x`
as a per-segment phase counter. **The intoxication SFX trigger isn't
in this sprite's body** -- it's in the engine's per-frame mosaic check
in Bank00 reading the `TouchedFuzzyMosaicTimer` value.

### 14.3 $012C Fly Guy / Whirly Guy (`init_fly_guy` Bank0C:14723 / `main_fly_guy` Bank0C:14813)

A coin-carrying flying enemy with 2 visual variants (fly / whirly).
Init reads `$70E2 & $0010` -> Y, then `$701900 = Y+1` (1 = fly variant,
2 = whirly variant). On first frame (`$701900 == 0`), it also packs the
spawn Y into the upper byte of `$701902` for the orbit anchor, then
dispatches to `DATA_fly_guy_init_variant_ptr[Y-1]`: the fly variant
gets standard cruise + Y-bob setup (X-speed from `DATA_0CF387 = $FFC0,
$0040`), the whirly variant gets spin-stepper setup ($7542 = $0020,
$75E2 = $0200, $6FA2 |= $0001 for the "rotate" tile flag, $7040 =
$2906). Main dispatches on the variant, drops a `$115 Coin` sprite
when stomped (via `CODE_0CF477` spawning into a new slot at the
sprite's current XY +Y10).

### 14.4 $00DA Flower Pot (`init_flower_pot` Bank0D:7607 / `main_flower_pot` Bank0D:7637)

Stationary collectible-spawning prop. Init caches spawn XY in
`$701900/$701902`, runs the key-tag check (`CODE_03D400`) to decide if
this pot has already been "used", and sets the head-bop hitbox
(`$7BB6 = $08`, `$7BB8 = $0C`). Main on head-bop (`$7D36 != 0`)
launches the pot with `YSpeed = $FD00` (upward bounce) and a signed
X-velocity from `DATA_0DBBC9 = $FFC0, $0040, $FF80, $0080` (4-direction
toss based on the toss-direction bits). Rideable.

### 14.5 $00DB Soft Block (`init_soft_block` Bank06:12085 / `main_soft_block` Bank06:12109)

The squishy deformable platform. Init picks base size from
`DATA_06E93C / DATA_06E940` (size A / size B) by bit `$10` of `$70E2`
(floor-orientation vs ceiling-orientation). Main runs **damped spring
physics**: each frame, `$76` and `$78` are signed displacement-from-rest
in X and Y; `$7BB6/$7BB8` track them via signed shifts. Spring force
restores toward 0 each frame (gravity-towards-center math at
Bank06:12131+). The block actually deforms visibly because the
SuperFX render reads per-vertex `$06`,`$02`,`$04`,`$00` corner-
displacement scratch ($00 / $02 are signed signed displacement of the
top corners; `$04` / `$06` of the bottom corners). The result is a
4-vertex bilinearly-distorted quad written to the tile-stamp pipeline.
There's no defeat -- the block is permanent terrain.

### 14.6 $0119 Spooky (`init_spooky` Bank05:14274 / `main_spooky` Bank05:14297)

Group of revolving ghost faces. 5-state `DATA_spooky_state_ptr` (states
0-3 + a stand-in 4):

| State | Handler | Behavior |
|---|---|---|
| 0 (revolve idle) | `CODE_05EC54` | Per-frame rotate; pick face-set via `DATA_05EA1B = FXDATA_550000+$0040, +$0020, +$0000` (3 sub-positions). |
| 1 (pause) | `CODE_05ECF2` | Brief halt at the cardinal direction. |
| 2 (charge swap) | `CODE_05ED3A` | Swap face-image during phase-change. |
| 3 (split/re-form) | `CODE_05EDFD` | The "ghost cluster splits into individual faces" animation. |
| 4 (re-uses idle) | `CODE_05EC54` | Same handler as 0 -- the "fully formed" state. |

Reacts to player passing through with `$6150` phase check (Bank05:
14331+). When Yoshi is in `$6150 == 3 or 4`, the cluster activates;
otherwise it stays in a frozen state. The activation also pushes the
"ghost cluster spotted" mood -- the per-bank atmosphere flag at
`$6150`.

### 14.7 $00F7 Barney Bubble (`init_barney_bubble` Bank0E:4196 / `main_barney_bubble` Bank0E:4220)

Floating bubble that traps Yoshi on contact. Init is trivial (`$7A36
= $0100` only). Main: 4-state `DATA_barney_bubble_state_ptrs`:

| State | Handler | Behavior |
|---|---|---|
| 0 (idle bob) | `CODE_0EA2FA` | Slow vertical bob via SFX-driven sine offset. |
| 1 (drift) | `CODE_0EA335` | Horizontal drift; can be steered by edge collision. |
| 2 (pop) | `CODE_0EA36B` | On hit-by-egg, transition here; brief 16-frame pop animation. |
| 3 (despawn) | `CODE_0EA433` | Final cleanup, free slot. |

Main draws via `FXCODE_0B86B6` for the circular bubble outline. When
Yoshi is inside the bubble (the capture lock at `$61B6 == this-slot`),
the bubble drags Yoshi vertically -- Yoshi's Y-position is overwritten
by the bubble's Y each frame. The bubble can be punctured: head-bop
(`$7D36 != 0`) advances state directly to 2 (pop). Hit-by-egg same
result.

### 14.8 $0107 Watermelon Seed (`init_watermelon_seed` Bank01:5720 / `main_seed` Bank01:5737)

The seed Yoshi spits when shooting watermelons. Init is a bare `RTL`.
Main: on `$7860 != 0` (ground/wall hit), spawn AmbSpr $229 (the
"smoke puff" tile), copy position + invert X-velocity, set Y-velocity
to $FD80, and despawn via `JML CODE_03A31E`. If `$7A38 != 0`
(death-set flag) and `$7D36 < 0` (off-screen above), call hit-flash
(`CODE_03A858`) + kill (`CODE_03B25B`) and set the seed-respawn flag
`$03BC = 1` (which the engine reads to decrement Yoshi's ammo).

### 14.9 $00E7 Burt the Bashful (`init_small_burt` Bank05:6134 / `main_small_burt` Bank05:6252)

The pants-dropping pink enemy. **16-state dispatcher** at
`DATA_small_burt_state_ptr` (Bank05:6233) -- the largest state machine
in any oddball. States cover: idle/inflate-watch, inflate, deflate,
hop-forward, post-hop, inflated-and-hopping, bounce-on-Yoshi,
post-bounce-launch, airborne, airborne-settle, defeat-fall,
defeat-finish, + 4 shared helper slots. The 16-entry table is unusual
in YI; most enemies use 4-8 state machines.

The **partner-pair** mechanism: Init at Bank05:6134 spawns a second
Burt on the opposite side of the room (via `CODE_spawn_sprite_active`
at Bank05:6172 with `XDelta = DATA_05ABAA,y` and
`YDelta = DATA_05ABAE,y`). The pair shares `$0EED` as a "twin
exists" semaphore. Only the first-Init Burt does the spawning; the
second checks `$0EED != 0` and skips. Both pants-drop hit the same
floor; the second's `$701902` carries a back-pointer to the first
slot via the `ORA #$0300` masking pattern.

The visual lore: Burts wear their pants up by inflating themselves;
deflate = pants slide down (the "bashful" expression). The inflate /
deflate state pair (1 and 2) is the player-meeting reaction.

### 14.10 $0101 RotatingMace + $0102 DoubleRotatingMace (`init_spiky_mace` Bank0D:68-69 / `main_spiky_mace` Bank0D:99-100)

Two rotating-mace variants share the same Init and Main. Init does:
- Standard `CODE_03AE60` floor-snap
- Stashes `$7722` (sprite-index lookup) in `$701902`
- Calls `CODE_03AD74` (live-test); on death-path (`BCS`), restores
  $7722 and JMLs CODE_03A31E
- Computes rotation direction from `$70E2 & $0010` into `$7400` and
  `$701900 = (variant_index - 1) ASL` (the variant identifier)
- Calls `CODE_0D82C0` (radius / SuperFX setup)

Main's `CODE_0D8065` setup draws the spike-on-tether assembly via
`FXCODE_0B8595` (the angled-line draw helper). It iterates 2 segments
(for single-spike mace $0101) or **4 segments** (for double-spike
$0102 -- the differentiator). After the loop, on `$0101` it RTSs; on
`$0102` it draws the **additional 4 connecting line segments** that
form the second mace head's spokes 180 degrees out of phase.

Bank0D:231-234:
```
LDA $7BD4 (SpriteID)
CMP #!Define_YI_NorSpr101_RotatingMace
BNE.b CODE_0D814F             ; the $102 extra-loop branch
RTS                            ; $101 path: done
```

Both play `SoundID1B_MaceTick` every $0008 frames (the tick of the
chain links). The shared OAM tile setup (`CODE_0D8000` family) is
reused; the spike collision uses the standard sprite hit-box.

### 14.11 $009E Chomp Rock (`init_chomp_rock` Bank0E:8105 / `main_chomp_rock` Bank0E:8143)

Pushable boulder, **no state table** -- Main does physics directly.
Init: detects level-context for spawn de-dup (Items, Castle level $28
via `$0E29` counter check + level-bg-1-tileset test); sets stomp
hitbox `$7BB6/$7BB8 = $000C`. Main: ground/wall collision via SuperFX
ACE2F probe (the universal tile-collision query), rolling sprite-
angle update, push-by-player-contact, plays `SoundID??` on motion.
The boulder accumulates angular momentum from player pushes and can
crush Yoshi on impact (the death path at `CODE_0EBEE8 BCS` cases).
The "no state table" pattern is distinctive: this is one of the
rare enemies where the per-frame Main is a flat sequence of
sub-routine calls rather than a `(DATA_state_ptr,x)` dispatch.

### 14.12 $01A0 DoubleFirebar + $01A1 Firebar (`init_firebar` Bank0C:4311-4312 / `main_firebar` Bank0C:4341-4342)

Two firebar variants share Init and Main (same address). Init picks
rotation direction from `$70E2 & $0010` into `$78,x` (the angular-step
direction: $FF00 or $0100). Sets `$70E2 += $FFF8` (snap back 8 pixels
in X to align with rotation pivot). $18 = $FFB8 (the initial rotation
angle), $76 = $0003 (visual variant index), $7A96 = $0006 (6-frame
inter-fire tick). Main draws via `FXCODE_0896DF` (the radial-arm draw
helper) with the control table `DATA_0CA003 = $4202, $0202, $4200,
$0200` (4 OAM control words for the arm tiles).

The arm count + arm length is encoded entirely in the spawn extra
fields + the `DATA_0CA003` control table. $1A0 / $1A1's actual
difference is **the SuperFX render counts more arm tiles** for $1A0 --
specifically, both call `FXCODE_0896DF` but the dispatch behind the
scenes draws 2 arms for $1A1 and 4 arms for $1A0 (the "double"
variant). Verified: the in-Main code is identical; the differentiation
is in the FX firmware reading sprite-ID-dependent arm-count.

### 14.13 $01A4 FortKeyholeCork (`init_cork` Bank07:15821 / `main_cork` Bank07:15845)

The cork at the end of every fort/castle level. Init snaps to 8-px
grid (X += 8, Y -= 7) so the keyhole tile lines up with BG art,
verifies host BG tile is the keyhole via `CODE_03D3F8`. If wrong tile,
self-destructs. Main waits for Yoshi to push it carrying the Key
sprite ($027). On success: despawn the key (`CODE_03BF87` + `03A31E`),
play `SoundID40_OpenDoor`, advance 4-step cork-pop animation (each
step inches the cork up via Y -= 2), then trigger level-clear via
the standard end-of-level path. The 4 cork-pop frames are timed via
`DATA_07FDE1 = $10, $10, $20` (16, 16, 32 frames per step) +
`SoundID40_OpenDoor` and `SoundID3B_Pop` (the final ejection).

### 14.14 Cross-references

- `yi/Banks/Bank01.asm:5710-5778` -- $107 Watermelon Seed.
- `yi/Banks/Bank03.asm:2725-2733, 4200-4241, 15240-15347` -- $0B3
  Fuzzy Fart + $129 Fuzzy.
- `yi/Banks/Bank05.asm:6128-6300, 14270-14400` -- $0E7 Burt the
  Bashful + $119 Spooky.
- `yi/Banks/Bank06.asm:12080-12230` -- $0DB Soft Block.
- `yi/Banks/Bank07.asm:15810-16000` -- $1A4 Keyhole Cork.
- `yi/Banks/Bank0C.asm:4300-4400, 14720-14900` -- $1A0/$1A1 Firebar +
  $12C Fly/Whirly Guy.
- `yi/Banks/Bank0D.asm:60-280, 7600-7730` -- $101/$102 Rotating Mace +
  $0DA Flower Pot.
- `yi/Banks/Bank0E.asm:4190-4400, 8100-8350` -- $0F7 Barney Bubble +
  $09E Chomp Rock.
- `docs/spritestateengine.md` -- the engine that runs every sprite's
  Init / Main / StompRt each frame.

---

## 15. Piro Dangle pair ($076 ClockwisePiroDangle / $077 CounterclockwisePiroDangle)

Two flame-on-a-chain swing variants. The chain pivots from a fixed
anchor; the flame head swings along a ~quarter-circle arc with a
distinct clockwise vs counter-clockwise sense. Both variants share
the same 5-state machine; the only difference observable at Init is
that $077 pre-seeds `$79,x = $0A` (the CCW direction marker).

A Piro Dangle is also spawned as a partner sub-sprite by sprite $0E3
BooBlahWithPiroDangle (see `docs/family-boos.md` §3.7) -- that path
allocates the slot via `JSL CODE_spawn_sprite_active` and links it
back to the Boo Blah via `$18,x`.

The whole family lives in `yi/Banks/Bank0D.asm` lines 6055-6271 plus
shared draw helper at 6292-6417.

### 15.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$076` | `ClockwisePiroDangle` | `init_piro_dangle_clockwise` Bank0D:6065 | `main_piro_dangle` Bank0D:6097 | passes Yoshi (flame damages) | Clockwise flame swinger. Init runs from `$079 = 0` default. |
| `$077` | `CounterclockwisePiroDangle` | `init_piro_dangle_anticlockwise` Bank0D:6057 | `main_piro_dangle` Bank0D:6098 | passes Yoshi (flame damages) | Counter-clockwise variant. Init pre-stores `$79 = $0A` then falls through into `init_piro_dangle_clockwise`. |

### 15.2 Init -- shared body

`init_piro_dangle_clockwise` (Bank0D:6065, `$0DAF52`):

1. `LDA #$0001; STA $701900` -- mark "first-frame initialization-pending"
   (the Main checks this flag and runs a different first-frame draw
   path until cleared).
2. `XBA; STA $7A36,x` -- store `$0100` into the orbital-angle / scale
   register `$7A36,x` (the chain-position parameter).
3. `STZ $7400,x` -- zero variant byte.
4. `LDA #$0040; STA $7542,x` -- arm 64-tick state timer.
5. `LDY #$04; STY $76,x` -- enter state 4 (the chain-swing oscillation).
6. RTL.

`init_piro_dangle_anticlockwise` (Bank0D:6057, `$0DAF4C`) is just
two instructions that pre-seed `$79,x = $0A` (the CCW direction
flag) then fall through into the clockwise body. So $077 starts in
state 4 with `$79,x = $0A`.

### 15.3 Main -- 5-state machine via `DATA_0DAF68`

`main_piro_dangle` (Bank0D:6097, `$0DAF7E`) per frame:

1. If `$7D96,x == 0`, call `CODE_0DB20B` (in-bank helper -- shared
   per-frame housekeeping for the chain draw).
2. Compute OAM-base index `Y = $7362,x + $0010`. If `$701900 != 0`
   (first-frame flag still set): paint the chain head in two
   $0010-stride tiles around `$7680/$7682,x` (the anchor cache),
   then `JSL CODE_03AA60` (sprite-finalize draw). Else update an
   AND/ORA bit at $6005,y from `DATA_0DAF7A[$78,x & $3]` (palette
   row cycle).
3. `JSL CODE_03AF23` (engine housekeeping). If `$701900 != 0`,
   `JSL CODE_03A5B7` (despawn-on-edge).
4. Dispatch state `$76,x` via `DATA_0DAF68` (pointer table, 9 entries
   covering states 0-8 but only the first 5 distinct handlers are
   used).
5. Tick `$7A96`: every 4 frames advance `$7A38 += $80` (mod $1FE,
   the orbital phase), increment `$7402` mod 4 (animation frame),
   and `$78` mod 4 (palette cycle for the chain flame).

`DATA_0DAF68` (Bank0D:6080, `$0DAF68`):

| `$76` | Handler | Behavior |
|---|---|---|
| 0 / 5 | `CODE_0DB02D` | Wind-up. If `$7A98 == 0` AND `JSL CODE_03AD74` (something checks edge / damage), preset `$16 = 4` and INC `$76`. Else RTS. |
| 1 / 6 | `CODE_0DB040` | Outward swing. Clears `$701900` (the init-flag). Each frame `$7A36 += 2`; when `>= $0124`, sets `$18 = 0`, INC `$76`, and clamps `$7A36 = $00E0` before final store. Calls `CODE_0DB24B` (draw flame head at $7A36 angle). |
| 2 / 7 | `CODE_0DB062` | Oscillating swing-back. Clears `$701900`. `Y = $18,x` selects `DATA_0DB05E[y]` = $0002 or $FFFE (forward/backward step). Add to `$7A36`. If `>= $0124`: DEC `$16`; on `$16 == 0` INC `$76`. EOR direction. Clamp to `$0124`. If `>= $01FF`: EOR direction, clamp to `$01FF`. Then `CODE_0DB24B`. |
| 3 / 8 | `CODE_0DB09C` | Wind-down. Each frame `$7A36 -= 2`. When `< $0100`: arm `$7A98 = $0040`, branch on `$76,x` -- if `<= 4` set $76=0, else set $76=5. Set `$701900 = $0100`, `$7A36 = $0100`, `JSL CODE_03AEFD`. Else continue ticking, draw. |
| 4 | `CODE_0DB102` | One-shot entry handler. Sets OAM attribute `$6FA2 |= $000B`. Branches on `$7860,x` (terrain hit): if zero, runs SuperFX `FXCODE_0ACE2F` (chain extent probe) at `$70E2+$0008, $7182+$0010`; if `R7 & $0004` returns set, picks an XY-speed pair from DATA_0DB0E2/DATA_0DB0EA/DATA_0DB0F2 indexed by `($70E2 bit 4) + ($79 != 0 ? 0 : 2)` and DATA_0DB0FA angle. Else dispatches to a per-sprite ID branch that picks one of DATA_0DB0D1 offsets -- the same path is reused by Mini Ravens ($03A/$03B) and Hootie The Blue Fish ($06D/$06E). Finally: zero `$7542`, INC `$19,x`, INC `$16,x`, INC `$76,x`. Specifically for $076/$077 (no ID match) the post-handler runs the `CODE_0DB1F6` arc-arming path and sets `$76 = 3` (entering the wind-down). |

The shared state-4 handler is a **family entry routine** for any
chain/orbit sprite. Piro Dangle, Mini Raven, and Hootie all enter
state 4 to bootstrap chain physics; the per-sprite-ID branches inside
`CODE_0DB102` pick the correct DATA_0DB0E2 / DATA_0DB0EA velocity
pair.

### 15.4 Cross-references

- `yi/Banks/Bank0D.asm:6048-6271` -- the Piro Dangle init/main pair.
- `yi/Banks/Bank0D.asm:6292-6417` -- shared `CODE_0DB102` chain-anchor
  entry routine (also used by Mini Ravens and Hootie).
- `docs/family-boos.md` §3.7 -- Boo Blah carrying a Piro Dangle
  ($0E3 spawns $076 as partner).
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $076 / $077.

---

## 16. Raven family ($03A / $03B Mini Ravens, $135 / $136 Circling Ravens)

Two raven sub-clusters share the **`CODE_0DB102` chain-anchor entry
routine** with Piro Dangle / Hootie (see §15.3). They differ in their
own Init bodies, dispatch tables, and final main bodies, but each
hits `CODE_0DB102` once to be told its orbit-speed pair.

The Mini Raven cluster ($03A/$03B) lives at Bank0D:7261-7429.
The Circling Raven cluster ($135/$136) lives at Bank0D:3159-3360.

### 16.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$03A` | `3MiniRavens` | `init_mini_raven` Bank0D:7270 | `main_mini_raven` Bank0D:7315 | head-bop hit | Spawner: first frame, spawns two additional `$03A` children at +/- DATA_0DB8C6 X offsets ($0050 / $0030); seeds child `$7AF6` so they skip the spawn loop. |
| `$03B` | `MiniRaven` | `init_mini_raven` Bank0D:7271 | `main_mini_raven` Bank0D:7316 | head-bop hit | Same Init entry as $03A, but the spawner-loop is gated by an ID check (`CMP #$003A`) -- $03B Init falls through with just speed pair set. |
| `$135` | `CirclingRaven` | `init_small_raven` Bank0D:3162 | `main_small_raven` Bank0D:3202 | head-bop hit | Slow orbit (DATA_0D98C6[0] = `$0100`). 2-state main: glide-in / orbit. |
| `$136` | `CirclingRaven` | `init_small_raven` Bank0D:3163 | `main_small_raven` Bank0D:3203 | head-bop hit | Fast orbit (DATA_0D98C6[2] = `$0400`). Init pre-seeds `$18,x = $0080` (larger phase offset). |

### 16.2 Mini Raven ($03A / $03B)

`init_mini_raven` (Bank0D:7270, `$0DB8CA`):

1. If `$7AF6,x != 0` (already seeded by parent spawner), skip directly
   to RTL -- this is the child-arm path used by the 3-pack's spawned
   children.
2. `Y = $7400,x` (placement byte), then `$78,x = DATA_0DB8C2[y]` =
   `$0A00` or `$0000` (the per-orientation cached speed value).
3. `STZ $7400,x`.
4. **Spawner gate**: if sprite ID != $003A, fall through to RTL --
   $03B is the singleton variant.
5. **3-pack loop**: `$02 = 2` (loop counter). For each iteration:
   `$00 = DATA_0DB8C6[$02]` (= `$0050` or `$0030` X offset);
   `JSL CODE_spawn_sprite_init` for sprite `$003A`. On success:
   copy parent X/Y into child, store cached `$78` into child's
   `$7019D8`, store loop offset `$00` into child's `$7AF6` (the
   "I have already been spawn-armed" flag), DEC $02 by 2, loop
   while `>= 0`.
6. RTL.

The 3-pack therefore produces 3 ravens total: 1 parent + 2 children.
Each child inherits the parent's speed sign via `$7019D8`.

`main_mini_raven` (Bank0D:7315, `$0DB918`):

1. If `$7362,x` has sign bit set -> `CODE_0DB988 RTL` (off-screen skip).
2. If `$CurrentStatus == $0012` (egg-hit / dying), branch to
   `CODE_0DB959` (the standard `JSL CODE_03AF23` + state dispatch).
3. If `$7D96,x` (egg-hit pending) is nonzero, also branch to $959.
4. Stash `$701900` -> `$0C`, run `CODE_0DB20B` (chain helper used
   by Piro Dangle too), restore `$701900`. If `$7AF6 == 0` AND
   `$7860 == 0` (no terrain) AND `$77 == 0` -> $959.
5. Else SBC the cached `$72C0/$72C2` from `$70E2/$7182` (parallax
   compensation when scrolling).
6. `JSL CODE_03AF23`; dispatch state via `DATA_0DB914` (`$76,x`):
   state 0 = `CODE_0DB102` (the shared chain-entry), state 1 =
   `CODE_0D8000` (TYX/RTS stub).
7. Call `CODE_0DB9CA` (per-frame velocity table sync + `$7402`
   anim).
8. Quantize XSpeed via `CODE_0DB989` (snaps `$0059 -> $0100`,
   `$FFA7 -> $FF00`, `$003E -> $00B5`, `$FFC2 -> $FF4B` -- the
   "canonical speed values" used by the orbit table).
9. Quantize YSpeed the same way.
10. If `$7D36,x` is set (Yoshi-collide), `JML CODE_0DC0F0` (standard
    sprite-hits-Yoshi damage). Else `JSL CODE_03A5B7` (despawn).
11. RTL.

The 2-state main is degenerate: state 0 calls into the shared chain
entry, state 1 RTSes. The actual motion is driven by `CODE_0DB9CA`
each frame, indexing DATA_0DB9AA (animation-frame x-offset) and
DATA_0DB9BA (palette/attrib byte) via `($7A38 ASL ASL XBA) +
($79 != 0 ? 8 : 0) + y`. So the per-orientation 8-step animation
walks through DATA_0DB9AA[0..7] for one direction, [8..15] for the
other.

### 16.3 Circling Raven ($135 / $136)

`init_small_raven` (Bank0D:3162, `$0D983D`):

1. `JSL CODE_03AE60` (standard sprite Init helper).
2. Capture initial X-position-8: `$70E2 - 8 -> $701900`. Check
   `(X - 8) & $0010` to pick `$78 = 0` or `$78 = 2` (initial
   half-side -- left vs right of orbit center). Cache `$78` in
   `$7400`.
3. Capture initial Y-position-8: `$7182 - 8 -> $701902`.
4. **ID branch**: if SpriteID != $0135, set `$18,x = $0080` (the
   per-orbit phase preload -- so $136 starts at a different angle
   on its orbit).
5. `JSR CODE_0D98FB` (per-frame draw / SuperFX scan) -- runs once
   in Init too, to register the sprite immediately.
6. RTL.

`main_small_raven` (Bank0D:3202, `$0D9879`):

1. `JSL CODE_03AA52` (standard scaffolding helper).
2. `JSL CODE_03AF23` (engine housekeeping).
3. Call `CODE_0D98CA` -- per-frame angle advance:
   `Y = $76,x`; if 0 (still in glide-in state), index angular speed
   `DATA_0D98C6[(SpriteID - $135) ASL]` = `$0100` for $135 or
   `$0400` for $136. Add to `$7A36,x` (orbital phase, 0-$1FF).
   Sign-extend high byte into `$7A38` (full 16-bit angle accumulator).
4. Call `CODE_0D98FB` (per-frame SuperFX draw at angle `$7A38`,
   radius FXDATA_550000+$4080 / +$40A0 by `$77,x`).
5. Call `CODE_0D994E` -- computes the actual orbit XY position
   from the angle via SuperFX `FXCODE_0B8595` (sine/cosine to XY),
   writes resulting offsets back into `$70E2/$7182` relative to
   the stored `$701900/$701902` orbit center.
6. Call `CODE_0D9998` -- every 4 frames toggles `$77,x ^= $0002`
   (the radius bit, alternating the orbit-anchor row).
7. Dispatch `DATA_0D9875[$76 * 2]` (2-state main):
   - State 0 = `CODE_0D99AF`: glide-in. For $0135, immediate RTS
     (the slow variant glides straight into orbit). For $0136,
     check `($7A38 - $18) BMI`; if not yet reached, RTS; if past,
     INC `$76` (enter state 1 = active orbit), store `$18 -> $7A38`
     to lock the phase, then on `$01FF` boundary set up sub-state
     `$10 & $1F + 4 -> $7A96` (a sub-cycle timer) and `$16 = 1`,
     else set `$7A96 = $0010` and `$10 & $0003 + $0003 -> $16`.
   - State 1 = `CODE_0D99EF`: active orbit. Decrement `$7A96`
     timer; on expiration runs additional per-direction housekeeping.
8. Post-dispatch: if `$7D36 BMI` (Yoshi-hit, sign bit set), check
   parallax offsets and either `JSL CODE_03A858` (hit-flash) or
   `JSL CODE_03A5B7` (despawn). Else if `$7D36` is positive
   (egg-hit), `JML CODE_0DC14C` (damage application). Else RTL.

`DATA_0D98C6` is just the 4-byte angular-speed table:
`$0100, $0400` -- slow vs fast orbit. The `(SpriteID - $135) ASL`
indexing means a hypothetical $137 would map to offset 4 (past the
end of the table); only $135 and $136 are valid users.

### 16.4 Cross-references

- `yi/Banks/Bank0D.asm:7261-7429` -- Mini Raven init/main + helpers.
- `yi/Banks/Bank0D.asm:3159-3360` -- Circling Raven init/main +
  CODE_0D994E orbit-XY-from-angle helper.
- `yi/Banks/Bank0D.asm:6292-6417` -- `CODE_0DB102` shared chain-anchor
  entry; Mini Ravens dispatch into it from state 0.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $03A / $03B /
  $135 / $136.

---

## 17. Roger's Pot trio ($034 Pot / $035 Potted Ghost / $038 Flame)

A 3-sprite cluster simulating "pot-with-ghost-in-it pushed by Shy
Guy". The pot (NorSpr $034) spawns the ghost ($035) as its first
child during Init, and ALSO conditionally spawns a Shy Guy pusher
($047) on its right-hand side. Once the ghost reaches its lunge
state, it spawns the flame ($038) as a forward-rolling projectile.

The whole cluster lives in `yi/Banks/Bank02.asm` lines 545-1547
(roughly $02:848B-$02:8F38), in 4 contiguous sub-blocks:

- 545-722 -- $034 RogersPot Init+Main (`init_roger`, `main_roger`)
- 731-798 -- $035 RogerThePottedGhost Init+Main bodies
  (`init_roger_2`, `main_roger_2`)
- 800-1414 -- shared 7-state machine + sub-handlers (idle / lunge /
  fall-back-in / spit / jump / land / despawn)
- 1423-1547 -- $038 PottedGhostFlame Init+Main (`init_roger_flame`,
  `main_roger_flame`)

Also at the top of the bank: `CODE_02808C` (Bank02:107 area) is a
shared helper that spawns AmbSpr $1D4 (flame-trail dust) and is used
by both the ghost ($035 spitting flames) and the flame ($038
trailing dust).

### 17.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$034` | `RogersPot` | `init_roger` Bank02:555 | `main_roger` Bank02:619 | (passive shell) | The pot itself. Init spawns the ghost ($035) + (conditionally) a Shy Guy pusher ($047). Loads palette DATA_5FE67E into mirror row $61. Main syncs X-speed onto ghost slot for visual sync. |
| `$035` | `RogerThePottedGhost` | `init_roger_2` Bank02:731 | `main_roger_2` Bank02:744 | head-bop hit | Roger the ghost. Init is `RTL` -- spawned by the pot. Main dispatches 7-state machine via `DATA_roger_state_ptr`; uses SuperFX `FXCODE_0A8390` for combined collision/draw. |
| `$038` | `PottedGhostFlame` | `init_roger_flame` Bank02:1423 | `main_roger_flame` Bank02:1456 | (passive on Yoshi-hit) | The flame projectile spat by Roger. Init is `RTL`. Main bounces along floor with XY-speed `+/- $0080`, drives 12-frame animation table (DATA_029096), ends on wall or sprite contact. |

### 17.2 Pot $034 -- spawns the ghost + pusher

`init_roger` (Bank02:555, `$02848C`) does:

1. `LDA #$0035; JSL CODE_spawn_sprite_active` -- spawn the ghost.
   On failure, `JML CODE_03A31E` (despawn pot immediately).
2. Mark ghost slot: `$701978 = $0006`, `$7860 = $0006`, store
   ghost slot index into `$18,x` (the pot's "linked-child" reference).
3. `JSR CODE_0284E1` -- copy pot's XY into ghost (so ghost shares
   pot's position).
4. `LDY #$2D; JSL CODE_0CE5D6` -- queue a graphic decompression
   (DMA setup for the pot's tilemap).
5. `LDA #$0047; JSL CODE_03A34E` -- spawn the Shy Guy pusher
   (see family-shyguys.md for $047). On success: position the Shy
   Guy `+$40 X` from the pot, same Y, link Shy Guy back to pot
   via `$701978 = pot_slot`.
6. Load the **CGRAM palette** at `DATA_5FE67E` (60 bytes / 30
   colors -- but only the low 4 colors of each are written via
   the DEX DEX BPL pattern: 60 bytes / 2-stride = 30 writes).
   Destination: live mirror at `$702E2E` AND global palette mirror
   row $61 (`YI_Global_PaletteMirror[$61]`).
7. RTL.

`main_roger` (Bank02:619, `$0284F6`) per frame:

1. `JSL CODE_03AF23` (engine housekeeping).
2. `Y = $18,x` (ghost slot), copy pot XY into ghost (sync position).
3. Copy pot XSpeed into ghost XSpeed and into pot's `$701902`
   (the pot's "intended X-speed" cache). Then zero pot's XSpeed
   (the pot doesn't actually move on its own).
4. If `$61B4 == 0` AND `$7D36,x BMI` (sprite-collide negative,
   typically the pusher): call `CODE_03D130` to query terrain.
   On success: queue a velocity flip via DATA_0284F2 / DATA_0284EE
   (`+$006C / -$00A0` Y-recoil; `+$0100 / -$0100` X-flip),
   set `$60DC++`, `$61C2++` (a sprite-flash / SFX counter),
   `JSL CODE_0D90A1` (the standard pusher-hit SFX).
5. Branch on ghost's `$701978`:
   - **`== $0006`** (default pre-defeat state): check player state.
     If in cutscene (`Define_YI_PlayerState02_InCutscene`), idle
     ($1015 counter logic + `$7A96 = $0040` lockout when `$60C0`
     reports player ready). When `$1015 BMI`, transition ghost
     to "active" by zeroing `$701978`, setting `$7A98 = $0180`
     (active lockout), `$7AF6 = $0100` (active-flag).
   - **`== $0004`**: ghost is in "lunge" state. Increment `$7542,x`
     up to $0040 (lunge timer). If `$7682,x >= $0300` (Y-speed
     past threshold), promote to next state: `$701978 = $0005`,
     `$7AF8 = $0040`, `$74A2 = $00FF`, push Explosion SFX,
     `$61C6 = $0060` (flash), call `CODE_02E1A3` (likely the
     defeat-particle helper at AmbSpr-spawn), then
     `JML CODE_despawn_sprite_free_slot`.
6. Mirror `$7860 & $0001` onto ghost's `$7860`. On set, zero
   pot's Y-speed. RTL.

### 17.3 Ghost $035 -- 7-state machine via `DATA_roger_state_ptr`

`init_roger_2` (Bank02:731) = `RTL` only. Initial state from spawn
is `$18 = 0` (state 0).

`main_roger_2` (Bank02:744, `$0285EB`) per frame:

1. `JSR CODE_02893E` -- per-frame helper (likely shared sub-handler;
   not deeply traced).
2. `JSL CODE_03AF23` (engine housekeeping).
3. Dispatch state via `(DATA_roger_state_ptr,x)` indexed by `$18,x
   * 2`. The 7 states are pointer-table at Bank02:803 and the
   trailing handler `CODE_02866F` (state 6) is just `TYX; RTS`
   (no-op end-of-life state).
4. After dispatch, SuperFX-draw via `FXCODE_0A8390`: writes (TXA,
   `$60B0`, `$60B2`, `$60C2`) into r12-r18 buffers and JSLs
   `RAM_YI_Global_BeginSuperFXProcessingRt`.
5. Post-FX: if `$601A != 0` (collision result), push `SoundID13
   SpringBounce`, apply Y-recoil to `$60B4` (clamp to `$FC00`
   max push-up).
6. If `$6014 != 0`, apply X-recoil to NorSpr_XSpeed (clamp to
   `$FE00`).
7. If `$7D36,x DEC BPL` AND `$7D38,y != 0`, transfer X -> Y and
   `JSL CODE_03B25B` (sprite kills sprite).
8. RTL.

`DATA_roger_state_ptr` (Bank02:803):

| `$18,x` | Handler | Behavior |
|---|---|---|
| 0 | `CODE_028687` | Idle / breathing loop. 12-frame animation cycle DATA_028671 with sub-times DATA_02867C ($01,$01,$01,$02,$02,$03,$04,$08,$04,$08,$04). When `$7041,x >= $20` (proximity to player), advances to lunge prep. If `$7A36 >= $0800` (delay timer), step to state 3. If `$7860 == 0` (no terrain under), play `SoundID82 BossFalling`, enter state 4 = lunge-fall. |
| 1 | `CODE_02879B` | (Lunge windup. Not deep-traced.) |
| 2 | `CODE_028827` | (Active lunge. Not deep-traced.) |
| 3 | `CODE_028874` | (Spit-flame: this is where $038 PottedGhostFlame gets spawned. Not deep-traced -- search `#$0038` in this block.) |
| 4 | `CODE_0288AA` | (Fall-into-pot / flop back. Not deep-traced.) |
| 5 | `CODE_0288FF` | (Defeat / explosion. Not deep-traced.) |
| 6 | `CODE_02866F` | `TYX; RTS` -- terminal state. |

(States 1-5 each contain ~30-50 lines of asm and need deeper
tracing to characterize precisely; flagged as "not deep-traced".)

### 17.4 Flame $038 -- the rolling projectile

`init_roger_flame` (Bank02:1423) = `RTL` only.

`main_roger_flame` (Bank02:1456, `$0290E6`) per frame:

1. `JSL CODE_03AF23`.
2. `INC $16,x` (frame counter).
3. If `$7A96 == 0` (first-frame init path): `$7540 = $0008` (Y-drag),
   `$75E0 = 0` (X-friction), `$7542 = $0040` (anim timer),
   `$75E2 = $FF80` (initial Y-speed up, low-jump-arc), `Y = 2`,
   branch to phase advance.
4. Else: if `$7D36 BMI` (Yoshi-hit), `JSL CODE_03A858` (hit-flash).
5. **Re-arm direction** (CODE_029113): if `$75E0 == 0` (no X-speed
   currently), and NorSpr_XSpeed == 0, zero `$7540`. If `$7AF6
   == 0` -> CODE_029133. Else fall through.
6. **CODE_029127**: each `$16 & $1F == 0` frame (every 32 frames),
   if `$16 & $40` -> CODE_02914A (Y-flip), else CODE_029133
   (X-flip).
7. **CODE_029133** (X-direction flip): `Y = 0` if `$7C16 BPL`
   (right of screen) else `Y = 2`. Load `DATA_0290DE[y]` =
   `$FF80` / `$0080` / `$FF00` / `$0100` (4-element X-velocity
   table -- but only entries 0 and 2 are picked here:
   `$FF80 / $FF00`). Store into `$75E0`. `$7540 = $0002`.
8. **CODE_02914A** (Y-direction flip): same pattern reading `$7C18`
   for Y-side; stores `$FF80/$FF00` into `$75E2` and `$7542 = $0002`.
9. **CODE_029161** (animation): if `$7A98 == 0`:
   `$18 += 2`. If `$18 == DATA_02908E[y]` ($0010 / $0018 -- max
   anim index for this phase), and `y != 0`: `JML CODE_03A31E`
   (despawn). Else if `y == 0`: clamp `$18 -> DATA_029092[y]`
   ($0008 / $0016).
10. Read `DATA_029096[$18]` (12-element frame-index table) into
    `$7402,x`. Read `DATA_0290AE[$18]` ($0040 only at indices
    6-7, else $0000) into `$7042` bits. Read `DATA_0290C6[$18]`
    ($0002/$0008/$0006 per-section) into `$7A98` (next-step delay).
11. RTL.

### 17.5 Cross-references

- `yi/Banks/Bank02.asm:545-1547` -- the full Roger cluster.
- `yi/Banks/Bank02.asm:107` area -- `CODE_02808C` shared flame-dust
  AmbSpr spawn helper.
- `docs/family-shyguys.md` -- $047 ShyGuyPushingPot (the pusher
  spawned by RogersPot Init).
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $034 / $035 /
  $038 (and $047 for the pusher).
- `yi/Constants/AmbientSpriteIDs.asm` -- `AmbSpr1D4` (flame trail
  dust).
- `yi/Constants/SoundIDs.asm` -- `SoundID47_Explosion`,
  `SoundID82_BossFalling`, `SoundID13_SpringBounce`.

---

## 18. Pulley cluster ($126 SpikedLogOnPulley / $127 PulleyOfSpikedLog / $10D BooGuyOperatingPulley)

Three sprites implementing chain-and-pulley mechanics. Two of them
($126 + $127) work as a paired duo: the spiked-log child ($126)
hangs from the pulley anchor ($127), and the pulley pulls the log
up when Yoshi stomps the log. The third ($10D) is a Boo Guy that
visually operates a pulley but isn't paired with the spiked-log --
it's used in scripted set pieces (Hookbill room is one likely
candidate, but the actual placement isn't traced here).

The pulley duo lives in `yi/Banks/Bank0D.asm` lines 2635-3160.
The Boo Guy variant lives in `yi/Banks/Bank01.asm` lines 5795-5953.

### 18.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$126` | `SpikedLogOnPulley` | `init_spiked_log` Bank0D:2638 | `main_chained_pulley_log` Bank0D:2734 | passes Yoshi (damages) | The spiked-log payload. Init spawns the partner $127 anchor and probes ceiling via SuperFX FXCODE_0ACDFA; hangs log at probed length. Main runs 4-state DATA_0D94ED. |
| `$127` | `PulleyOfSpikedLog` | `init_pulley` Bank0D:3059 | `main_pulley` Bank0D:3069 | (passive) | The pulley anchor / chain top. Init is `RTL`. Main watches partner's `$7D36` stomp flag; on hit, pulls log up `Y-speed = $FFC0`, decrements `$701900` (remaining-springs counter), arms `$7019D6 = 1` (player-bumped flag), plays `SoundID5A_PulleySqueak` every 4 frames, renders chain via FXCODE_088205. |
| `$10D` | `BooGuyOperatingPulley` | `init_pulley_guy` Bank01:5795 | `main_pulley_guy` Bank01:5833 | head-bop hit | A Boo Guy visually tugging a pulley rope. Init snaps X to 32px boundary, sets facing from X bit 4, OAM `$1885`. Main runs 6-state DATA_01AE89; pulley-squeak SFX every 4 frames during states 1-4. Standalone -- no $126/$127 link. |

### 18.2 Spiked Log $126 -- spawn anchor + chain physics

`init_spiked_log` (Bank0D:2638, `$0D9439`):

1. `LDA #$0127; JSL CODE_spawn_sprite_active` -- spawn the
   pulley anchor.
2. On spawn failure: `JML CODE_03A31E` (despawn).
3. `TYX` (X = anchor slot), `JSL CODE_03AD74`. On `BCS` (terrain-
   present), preserve X = self slot.
4. Otherwise `JSL CODE_03A31E` (despawn).
5. (CODE_0D9453): set `$77 (X = self)` -- `JSR CODE_0D9803`
   (the pulley draw scaffold, in-bank helper at 3134).
6. Copy log XY into anchor.
7. Link self into anchor: anchor's `$701978 = self_slot`,
   self's `$18,x = anchor_slot` (cross-link).
8. `$7400,x = 0`; `$7720,x = $0007` (initial chain ticks; the
   "springs remaining" / max-stomps counter).
9. **Ceiling probe**: stash `$70E2 + $000E` -> SuperFX R1,
   `(probe_x - 8) -> $70E2`. Set `R2 = $7182 + $0030`,
   `R3 = 0`, `R4 = $0010` (probe column width).
   Run SuperFX `FXCODE_0ACDFA` (ceiling-distance probe).
   On return, `Y = R12` (returned hit-distance in tile rows).
10. If `Y < $0C` -- close ceiling, hangs immediately:
    `$7A36 = $8000` (sentinel = "fully retracted"), `XBA;
    BRA CODE_0D94C5`.
11. Else: `LDA #$0014 SBC R12 ASL ASL ASL ASL` -- ((20 - depth)
    * 16) = chain-length-in-pixels into `$7A36`.
12. Add `$7A36` to `$7182,x`, SBC `$0010` -- positions log at
    chain-length below ceiling.
13. Mirror chain length: `Y = $18`, anchor's `$7A36,y = computed`.
14. `$78,x = computed_length`; `STZ $7400,x`.
15. `LDA #$000F SBC R12` -- (15 - probe_depth) clamped via
    `#$0003 MIN`, store into `$701900` (number of stomps this
    pulley can handle before it bottoms out).
16. RTL.

`DATA_0D94ED` (Bank0D:2725, `$0D94ED`):

| `$76` | Handler | Behavior |
|---|---|---|
| 0 | `CODE_0D8000` | TYX/RTS stub (idle / hanging). |
| 1 | `CODE_0D96A5` | Descending (chain extending; not deep-traced). |
| 2 | `CODE_0D96BC` | Ascending (pulley winding chain up; not deep-traced). |
| 3 | `CODE_0D96DF` | Stomp recoil (not deep-traced). |

`main_chained_pulley_log` (Bank0D:2734, `$0D94F5`) per frame:

1. `JSR CODE_0D9560` (chain-tile rendering -- $0DAF63-equivalent
   helper, draws the chain link tiles between log and anchor).
2. `JSL CODE_03AF23` (engine housekeeping).
3. `JSR CODE_0D95EE` (per-frame helper; not deep-traced).
4. `JSL CODE_03A299` (off-screen check). On BCS: `Y = $18`
   (anchor), `TAX`, `JSL CODE_03A31E` (despawn anchor),
   `JML CODE_03A31E` (despawn self).
5. Dispatch state via `(DATA_0D94ED, $76 * 2)`.
6. `JSL CODE_03D127` (per-frame helper).
7. **Stomp/collision check**: if `$7D36 DEC BNE`, compute
   `$7CD6 - $7CD6,x` (delta from previous frame) into `$00`,
   EOR with NorSpr_XSpeed. On non-matching sign, recoil:
   add `$7BB6 + $7BB6,x` (bounding box width) flipped by sign,
   shove `$70E2` of the parallax background. Negate
   `NorSpr_XSpeed`. RTL.
8. Else `JSL CODE_03A5B7` (despawn-on-edge).

### 18.3 Pulley anchor $127 -- watches partner stomp, pulls chain

`init_pulley` (Bank0D:3059) = `RTL` only.

`main_pulley` (Bank0D:3069, `$0D9771`) per frame:

1. `JSL CODE_03AA52` (sprite-engine helper).
2. `JSL CODE_03AF23`.
3. Branch on `$7D36,x` (collision-with-something):
   - `== 0`: skip to housekeeping (CODE_0D97C3).
   - `BMI` (BPL fails, sign-positive sprite-collide): `JSL
     CODE_03A858` (hit-flash). Branch to housekeeping.
   - **Valid sprite hit** (Y holds collider slot): if `CurrentStatus
     != $0010` (not active), skip. If `$7D38,y == 0` (no damage
     flag), skip. Otherwise `TYX; JSL CODE_03B25B` (kill the
     egg / projectile that hit).
4. **Stomp-relay** (CODE_0D9787 path): `Y = $18,x` (partner log
   slot). If `NorSpr_YSpeed,y BMI` (log already moving up), skip.
   `LDA $701900,y DEC BMI` (springs-remaining underflow) -> skip.
   Decrement `$701900,y` -- consumed one stomp.
5. `LDA $7019D8,y SBC $0016 STA $7019D8,y` -- shrink chain length.
6. `LDA #$FFC0 STA NorSpr_YSpeed,y` -- launch log upward.
7. `STZ $7542,y`, `$7019D6,y = $0001` (player-bumped flag).
8. (CODE_0D97C3): Y = $18; if log's YSpeed != 0 AND `(log_Y & 2)
   == 0`, push `SoundID5A_PulleySqueak`.
9. Compute `SuperFX R0 = $7A36 - log_Y`, `R6 = $0C00` (chain-color
   accent). Run SuperFX `FXCODE_0B86B6` (a generic sine helper).
10. Take `R0 & $01FE -> $7A38` (the chain-display angle).
11. `JSR CODE_0D9803` (draws the chain via `FXCODE_088205` at
    angle $7A38).
12. RTL.

### 18.4 Boo Guy on Pulley $10D -- standalone 6-state animator

`init_pulley_guy` (Bank01:5795, `$01AE76`) -- already documented in
existing block comment at Bank01:5790:

1. `(X & $0010) >> 3 -> $7400,x` (facing bit from X-position bit 4).
2. `$7040,x = $1885` (OAM attr -- palette + tile select for the
   pulley sprite).
3. RTL.

`main_pulley_guy` (Bank01:5833) -- per existing block comment,
6 states via `DATA_01AE89` (Bank01:5810):

| `$76` | Handler | Behavior |
|---|---|---|
| 0 | `CODE_01AEB9` | Idle animation cycle: every 4 frames INC `$7402` until 12 (`$0C`), wrap to 0. |
| 1 | `CODE_01AEDA` | Pulley-tug increasing. INC `$7402` until 20 (`$14`); arm `$7A98 = DATA_01AED3[$7402 - $0D]` = $04 $03 $02 $01... (accelerating). At 20: set `$7402 = $0010`, INC `$76`. |
| 2 | `CODE_01AEFD` | Pulley spinning. `$7402 = (frame + 1) & 3 \| $10` -- frames $10/$11/$12/$13 cycle. |
| 3 | `CODE_unused_8000_stub` | Stub `BRA` (no-op state -- effectively unreachable). |
| 4 | `CODE_01AF10` | Pulley pause. Decrement `$16,x`; on 0: arm `$7A98 = $08`, `$16 = $B`, `$7402 = 0`, INC `$76`. Else `$7A98 = DATA_01AF0C[$16-1]`, EOR `$7402 ^= 7`. |
| 5 | `CODE_01AF49` | Pulley winding back. DEC `$16`; on 0 -> reset to state 0 ($7402 = 0, $76 = 0). Else `$7A98 = DATA_01AF3F[$16-1]` = $04 $05 $06 $07 $08*7 (decelerating). INC `$7402`. |

SFX: every 4 frames during states 1-4 (skipping state 0 and 5),
push `SoundID5A_PulleySqueak`.

### 18.5 Cross-references

- `yi/Banks/Bank0D.asm:2635-3160` -- spiked log + pulley anchor pair.
- `yi/Banks/Bank01.asm:5795-5953` -- Boo Guy operating pulley.
- `yi/Constants/SoundIDs.asm` -- `SoundID5A_PulleySqueak`.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $126 / $127 /
  $10D.
- SuperFX entry points: `FXCODE_0ACDFA` (ceiling probe),
  `FXCODE_088205` (chain renderer), `FXCODE_0B86B6` (sine helper).

---

## 19. Thunder Lakitu fire-blast chain ($049 / $04A / $04B)

A 3-sprite chain that implements Thunder Lakitu's projectile attack.
The parent is **sprite $0A2 ThunderLakituFireball** (not Thunder
Lakitu itself), which is documented in `docs/family-clouds.md`.
The chain works like this:

1. $0A2 ThunderLakituFireball detects a level-clear conditional
   at Bank0E:6573 and falls into spawner `CODE_0EB302`.
2. Spawner first spawns **one $04A child** (the persistent burst
   ball) at parent XY.
3. Then in a `DEY/DEY` 3-iteration loop (Y = 2, 0, -2), spawns
   **three $0049 children** each with a different XSpeed picked
   from `DATA_0EB278` (the directional-velocity 3-pair table).
4. Plays `SoundID3E_Tongue`, sets screen-flash `$61C6 = $0020`,
   despawns the fireball.

All three children share **the same Init** (`init_thunder_lakitu_fire_blast`
at Bank04:9381) which is just `RTL` -- no per-spawn setup; the parent
pre-populates the slot fields. Two distinct Mains drive them:

- `$0049` Main is the directional-charge body: spawns ONE $004B
  on `$7A96 == 0`, plays `PiranhaPlantMunch` SFX, despawns when it
  drifts past +/- $0100 from anchor.
- `$004A` and `$004B` share `main_thunder_lakitu_fire_blast_23`
  (Bank04:9450) -- the per-frame animation handler.

Lives in `yi/Banks/Bank04.asm` lines 9381-9485.

### 19.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$049` | `ThunderLakituFireBlast1` | `init_thunder_lakitu_fire_blast` Bank04:9381 | `main_thunder_lakitu_fire_blast_1` Bank04:9390 | passes Yoshi (damages) | Directional charging body. Init = RTL. Main spawns one $04B child (the persistent burst) after $7A96 timer expires, plays `SoundID39_PiranhaPlantMunch`, then despawns once it drifts past +/-$100 X from anchor. |
| `$04A` | `ThunderLakituFireBlast2` | `init_thunder_lakitu_fire_blast` Bank04:9382 | `main_thunder_lakitu_fire_blast_23` Bank04:9450 | passes Yoshi (damages) | Persistent burst spawned **once** by the parent $0A2. Steps DATA_04CACD/DATA_04CADC/DATA_04CAEB animation. Despawns when `$18,x` underflows. |
| `$04B` | `ThunderLakituFireBlast3` | `init_thunder_lakitu_fire_blast` Bank04:9383 | `main_thunder_lakitu_fire_blast_23` Bank04:9451 | passes Yoshi (damages) | Sub-burst spawned by **a $0049 child** (not by parent). Same animation handler as $04A; differs only in spawn timing and despawn condition (calls `CODE_03A858` cull check past frame 4). |

### 19.2 Spawner chain

`CODE_0EB302` (parent in Bank0E:6596) spawn sequence:

1. Spawn $04A (the persistent burst). Set on it:
   `$701978 = $000B` (anim phase offset);
   `$7B58 = $000C` (post-anim Z-priority);
   `$7A98 = $0003` (frame delay);
   `$7BB8 = $0004` (initial draw extent).
2. Loop `Y = 2 downTo 0 step -2`:
   - Save Y; load `DATA_0EB278[y]` (one of three pre-computed
     XSpeed values) into `$00`.
   - Spawn $0049. On success: copy parent XY to child; set
     child's `$701902 = parent_X` (the "anchor X" for the
     `+/-$100` despawn check); set child's `NorSpr_XSpeedLo =
     $00` (the per-slot XSpeed).
   - Pop Y, DEY DEY, loop while BPL (Y = 2, 0, -2 -> 3 iterations).
3. `$61C6 = $0020` (white-flash); push `SoundID3E_Tongue`.
4. `JML CODE_03A31E` (despawn parent $0A2 fireball).

Net effect: ONE persistent $04A explosion sprite + THREE directional
$0049 charging streams. Each $0049 spawns a SECOND $04B mini-burst
in its own Main after $7A96 expires. So per fireball-burst: 1 $04A
+ 3 $0049 + up to 3 $04B = up to 7 children.

### 19.3 Phase-1 ($0049) Main

`main_thunder_lakitu_fire_blast_1` (Bank04:9390, `$04CA62`):

1. `JSL CODE_03AF23` (engine housekeeping).
2. Check terrain bits in `$7860,x`:
   - If `$0001` set (ground): if `& $000C` is clear, fall through
     to spawn-or-cull. Else `JML CODE_03A31E` (despawn).
3. `LDA $7A96,x BNE` (timer still ticking): skip to despawn-distance
   check.
4. **Spawn one $04B child** via `LDA #$004B; JSL CODE_spawn_sprite_active`.
   On success: copy XY to child, set `$7402,y = $0001`,
   `$7BB8 = $0002`, `$7A98 = $0003`, `$701978 = $0008`,
   `$7019D8 = $000B`, `$7B58 = $000C`. Push `SoundID39_PiranhaPlantMunch`.
   Re-arm `$7A96 = $0006`.
5. Despawn check: `(70E2,x - 701902,x) + $0080`. If `>= $0100`,
   the X has drifted past `+/-$0100` from anchor -> `JML CODE_03A31E`.
6. RTL.

### 19.4 Phase-2/3 ($04A / $04B) shared Main

`main_thunder_lakitu_fire_blast_23` (Bank04:9450, `$04CAFE`):

1. `JSL CODE_03AF23`.
2. If `$7A98,x != 0`: skip animation step (frame delay).
3. Else: DEC `$18,x` (frame index). On BPL (still valid index):
   advance frame. On BMI: `JML CODE_03A31E` (despawn).
4. Frame advance: `Y = $18 + $78` (per-child phase offset from
   spawner). Read `DATA_04CACD[y]` (15-byte table, OAM tile index)
   into `$7402,x`. Arm `$7A98 = $0003` (next-frame delay).
5. Read `DATA_04CADC[y]` ($0F,$0E,$0D,$0C,$04,$08,...,$00*4) into
   `$7BB8,x` (sprite-width extent).
6. Read `DATA_04CAEB[y]` (19-byte table) into `$7B58,x` (sprite-Z
   or anim alt-bit).
7. **Late-life cull** (CODE_04CB36): if `$18 < $04` (past first-3
   "fully ramping" frames), check `$7D36,x BPL`. On set, `JSL
   CODE_03A858` (despawn or fade).
8. RTL.

### 19.5 Cross-references

- `yi/Banks/Bank04.asm:9381-9485` -- shared Init + two Main bodies +
  3 animation tables.
- `yi/Banks/Bank0E.asm:6596-6641` -- `CODE_0EB302` parent $0A2
  spawner.
- `docs/family-clouds.md` -- $06B Thunder Lakitu + $0A2
  ThunderLakituFireball (the parents).
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $049 / $04A /
  $04B.
- `yi/Constants/SoundIDs.asm` -- `SoundID39_PiranhaPlantMunch`,
  `SoundID3E_Tongue`.

---

## 20. Incoming Chomp cluster ($0A6 / $0A7 / $0A8 / $0A9)

A 4-sprite particle-system implementation of the "giant Chomp
crashes down at the player" set piece. Two parent forms exist:

- **$0A6 IncomingChomp** -- the **single** foreground giant Chomp.
- **$0A7 GroupOfIncomingChomps** -- a **swarm** of 7 sub-particles
  driven from a WRAM table at `$0DC6-$0DEE` (7 entries x 5 bytes
  each).

Both parents reach the same `DATA_incoming_chomp_state_ptrs`
(Bank0E:630) -- the 7-state pointer table. They animate via
per-particle position + frame state, but the single $0A6 follows
the **canonical state machine** directly while $0A7 dispatches
per-particle through `CODE_0E8C9A` (the per-particle motion update).

$0A8 FallingIncomingChomp is the secondary "launched chomp body"
spawned during the launch state (state 3 or 4) -- it picks up the
shared state-ptr table at state 5+ (the ground-impact / shadow /
despawn phases). $0A9 IncomingChompShadow is the ground-projected
shadow oval, drawn from FXDATA_548000+$60E0 with 4 frames of
palette-cycling.

Cluster lives in `yi/Banks/Bank0E.asm` lines 527-1939.

### 20.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$0A6` | `IncomingChomp` | `init_incoming_chomp` Bank0E:529 | `main_incoming_chomp` Bank0E:646 | head-bop hit | Single foreground giant Chomp. Init reads $0073 (group-spawn guard). Main dispatches DATA_incoming_chomp_state_ptrs via $76. Uses SuperFX (FXCODE_088A0F) for polygon outline. |
| `$0A7` | `GroupOfIncomingChomps` | `init_incoming_chomp_flock` Bank0E:543 | `main_incoming_chomp_flock` Bank0E:1548 | (per-particle hit) | 4-particle swarm (7 sub-particles in WRAM table). Init uses global `$0DC2` (1-instance guard) and seeds 7 sub-particles in `$0DC6-$0DEE`. Main runs per-particle XY + frame state machines via CODE_0E8C9A. |
| `$0A8` | `FallingIncomingChomp` | `init_incoming_chomp_falling` Bank0E:615 | `main_incoming_chomp` Bank0E:647 | head-bop hit | The secondary launched body spawned by $0A6 during launch state. Init clears `$7042 bit $0020`. Main shared with $0A6 -- picks up at state 5+ (ground-impact / shadow). |
| `$0A9` | `IncomingChompShadow` | `init_incoming_chomp_falling_shadow` Bank0E:1856 | `main_incoming_chomp_falling_shadow` Bank0E:1873 | (passive) | The dark oval projected on terrain under a falling Chomp. Init and Main both call `CODE_0E8E6B` which runs SuperFX FXDATA_548000+$60E0 to render a 4-frame palette-cycling shadow. Tracks falling Chomp altitude via `$7A36` (0-$01FF) to grow shadow as it nears ground. |

### 20.2 $0A6 Init -- single-instance perch setup

`init_incoming_chomp` (Bank0E:529, `$0E8395`):

1. `LDY $0073 BNE CODE_0E83AF` -- if global-group flag set, **despawn
   immediately** (`JML CODE_03A31E`). This is the "one-of-each"
   gate that prevents both $0A6 and $0A7 from co-existing.
2. Else `SEP $20; LDA #$40; STA $70E0,x; REP $20` -- set
   per-slot byte-flag.
3. Fall through into shared `CODE_0E83CC` (perch setup).

### 20.3 $0A7 Init -- 7-particle swarm seed

`init_incoming_chomp_flock` (Bank0E:543, `$0E83A0`):

1. `LDY $0073 BNE CODE_0E83AF` -- if single-form has been spawned,
   despawn.
2. `LDY $0DC2 BEQ CODE_0E83B3` -- the **1-instance guard**:
   $0DC2 is the "group already spawned" counter. If non-zero,
   despawn.
3. (CODE_0E83B3): `INC $0DC2` (claim the slot).
4. Snap parent X to grid: `$70E2 & $FF00 + $0080 -> $0DC4`.
5. `$70E2 -= $0020` (shift parent left).
6. Fall through into shared `CODE_0E83CC` (perch setup).

The shared post-init (Bank0E:562 `CODE_0E83CC` onward):

1. Capture `Layer1XPos & $FFF0 -> $00`, cache `$70E2 -> $18,x`.
2. `$70E2 = parent_X - $00` shifted... (parallax-anchored re-centering).
3. `$701900,x = computed_X` (the anchor for state-2 lunge).
4. Compute `$7182 - Layer1Y + Layer2Y & $FFF8 + $0012 -> $7182,x`.
5. Level-specific Y-offset: at `MarchingMildesFort` (level $9A),
   `$7182 -= 8`. At `WatchOutBelow` (level $C2 area 6), `$7182 -= $0A`.
6. For $0A7 only: `$7182 += $0016` (parent flock is positioned
   slightly lower than the singleton).
7. `$701902,x = $7182,x` (the anchor for state-2 vertical).
8. `INC $74A1,x` twice (palette-row preset).
9. Fall through into `init_incoming_chomp_falling` (Bank0E:615)
   which is just one instruction: `$7042 &= $FFDF` (clear
   render-flip flag) + RTL.

### 20.4 $0A8 Init -- secondary launched body

`init_incoming_chomp_falling` (Bank0E:615, `$0E8439`) is a 2-line
helper that **also serves** as the tail of the perch-setup for
$0A6/$0A7. So when $0A6/$0A7 perch via CODE_0E83CC, they always
end by clearing the `$0020` bit -- this is the visual "tongue-up"
preset.

### 20.5 Shared Main dispatcher

`DATA_incoming_chomp_state_ptrs` (Bank0E:630, `$0E8440`):

| `$76` | Handler | Behavior |
|---|---|---|
| 0 | `CODE_0E8515` | Perch / windup. (Not deep-traced.) |
| 1 | `CODE_0E85B2` | Charge / wind-up rumble. (Not deep-traced.) |
| 2 | `CODE_0E85FE` | Launch (spawns $0A8 + $0A9). (Not deep-traced.) |
| 3 | `CODE_0E866E` | Falling (animation + position tracking). (Not deep-traced.) |
| 4 | `CODE_0E8713` | Impact / ground-pound. (Not deep-traced.) |
| 5 | `CODE_0E88D7` | Ground-shadow flash / settle. (Not deep-traced.) |
| 6 | `CODE_0E89DE` | Despawn cleanup. (Not deep-traced.) |

`main_incoming_chomp` (Bank0E:646, `$0E8456`) per frame:

1. `LDY $7041,x BPL` (sign-positive = normal): otherwise check
   `$7722 BMI` and `JSL CODE_03ABFA` (corrective draw).
2. `JSL CODE_03AF23` (engine housekeeping).
3. Dispatch state via `(DATA_incoming_chomp_state_ptrs, $76 * 2)`.
4. **Post-dispatch**: if `$76 >= 5` (in late states):
   - Check `$7D36,x DEC BMI`: if collider slot found AND
     `CurrentStatus == $0010` AND `$7D38,y != 0`, TYX +
     `JSL CODE_03B25B` (kill collider sprite).
5. `JSL CODE_03D127` (per-frame helper).
6. Call `CODE_0E84BA` (state-independent per-frame work; not
   deep-traced).
7. **SpriteID dispatch**: `SpriteID - $0A6 ORA $7A38`. If zero
   (= $0A6 with $7A38 == 0): X-bounds collide test (Yoshi X within
   $0020 of anchor) -> branches into the actual gameplay damage
   path. Else fall through and RTL.

### 20.6 $0A7 swarm Main

`main_incoming_chomp_flock` (Bank0E:1548, `$0E8BE4`):

1. `LDY $78,x BEQ CODE_0E8BEB`: if $78 != 0 (post-launch state),
   call `CODE_0E8C1C` (the per-particle position update).
2. `JSL CODE_03AF23`.
3. **Bounds check** (CODE_0E8BEB): `$7680 + $00A0`. If `>= $0200`
   (left-of-screen far): parallax-compensate `$70E2 -= $72C0`,
   `$7182 -= $72C2`. RTL.
4. Else: `TXY; LDA $76,x ASL TAX; JSR (DATA_incoming_chomp_state_ptrs)`.
5. Call `CODE_0E8C9A` (per-particle motion finalize; not deep-traced).
6. RTL.

`CODE_0E8C1C` (per-particle position update, Bank0E:1580):

1. Check `$7363,x BPL RTS` -- only update on positive sign.
2. Read 7-particle table starting at `$0DC6`:
   - `$0DC6,x` (X bits), `$0DCE,x` (Y bits), `$0DE7,x` (Z),
     `$0DD6,x` (XSpeed), `$0DDE,x` (YSpeed), $0DD7,x` (signed
     Z-step / wobble), `$0DDF,x` (acceleration?).
3. For each particle (X = 6, step -1): compute per-particle XY
   into `$6008/$600A,y` (OAM-y indexed by `$7362,x`), then
   apply step velocity, write back, check overflow + clamp.
4. Trail-fade behavior: when `$0DD7,x` is the sign-keeper and the
   computed XY position crosses zero, zero the row.

The 7-particle stride is **5 bytes** per particle in WRAM table
$0DC6-$0DEE (= 7 * 5 = 35 = $23 bytes -- though the precise
stride and field count is interpretive).

### 20.7 $0A9 IncomingChompShadow

`init_incoming_chomp_falling_shadow` (Bank0E:1856, `$0E8DFE`) and
`main_incoming_chomp_falling_shadow` (Bank0E:1873, `$0E8E08`) both
call `CODE_0E8E6B` (the SuperFX shadow-render at Bank0E:1922):

```
LDA $7A36,x AND $00FF ASL ASL XBA TAY
SEP #$20
LDA $7042,x AND #$F1 ORA DATA_0E8E04,y STA $7042,x  ; palette-cycle
REP #$20
LDA #FXDATA_548000+$60E0
LDY #(FXDATA_548000+$60E0)>>16
JSR CODE_0E84DA  ; the actual SuperFX render call
RTS
```

`DATA_0E8E04` (Bank0E:1867) = `$0C,$0E,$0A,$0A` -- 4 palette-cycle
values selected by `($7A36 & $FF) >> 6`. So $7A36 acts as a 0-255
proximity-to-ground tracker: at $00 the shadow is small/dim
(palette $0C), at $FF the shadow is large/bright (palette $0A).

Main also handles two special cases:

1. If `$0030 == $18,x` (frame counter match): `$74A2 = $0004`
   (palette reset).
2. Per `$78,x` branch (post-impact mode), if `$7722 BPL` (sprite
   alive): set `$7402 = $0004`, `$7040 = $2081`. `JML CODE_03A31E`
   (despawn).
3. Else if `$7AF6 != 0` (alive-flag), same OAM setup then
   `JML CODE_03AEFD` (clean despawn).
4. Else: `$7A36 += $0010` clamped to `$01FF` (proximity grows),
   call `CODE_0E8E6B` (render shadow).

### 20.8 Cross-references

- `yi/Banks/Bank0E.asm:527-1939` -- the full Incoming Chomp cluster.
- `yi/Memory/WRAM_Buffers.asm` -- the `$0DC2` 1-instance guard +
  `$0DC4` X-anchor + `$0DC6-$0DEE` 7-particle table.
- `yi/Constants/LevelIDs.asm` -- `MarchingMildesFort`,
  `WatchOutBelow` (the two levels with special Y-offset adjustments).
- SuperFX entry points: `FXCODE_088A0F` (Chomp polygon outline),
  `FXDATA_548000+$60E0` (shadow render).
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $0A6 / $0A7 /
  $0A8 / $0A9.

Note: Chomp is NOT a koopa cousin -- the Chain Chomp lineage in
mainline Mario is distinct from YI's Incoming-Chomp set piece;
$0A6-$0A9 do not share state-ptrs or main bodies with shell-koopa
sprites. No cross-ref to `family-koopas.md` warranted.

---

## 21. Huffin Puffin family ($028 Chick / $0F6 Mother)

A 2-sprite pair where the parent bird ($0F6) lays clutches of chick
sub-sprites ($028) on demand. Chicks act as edible / throwable
projectiles -- the unique mechanic is that when Yoshi swallows then
throws a chick, the chick **boomerangs back toward Yoshi** via
sine/cosine velocity composition driven from the throw angle.

Mother bird is killable by direct stomp on the parent slot (not on a
chick). Each chick is independently killable.

Lives in `yi/Banks/Bank0E.asm` lines 4619-5198 (parent
4619-4753, shared helpers 4756-5010, chick 5017-5198+).

### 21.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$028` | `HuffinPuffin` | `init_huffin_puffin_running` Bank0E:5017 | `main_huffin_puffin_running` Bank0E:5044 | head-bop hit | Post-hatch running chick. 3-state main (run / jump / land). Main computes sine/cosine velocity off throw-angle so a thrown chick returns toward Yoshi. |
| `$0F6` | `MotherHuffinPuffin` | `init_parent_huffin_puffin` Bank0E:4619 | `main_parent_huffin_puffin` Bank0E:4692 | head-bop hit | Parent. Init runs SuperFX `FXCODE_0991D5` (collision-scan), returns R6 = a count. Spawns `(R6 - 6)` chick sub-sprites in a vertical strip arrangement using `$7A96 = $0010, +$0008/each` (so chicks are vertically stacked at $0010, $0018, $0020, ... initial Y offsets). 4-state main: idle / lay-eggs / panic / despawn. |

### 21.2 Mother $0F6 -- Init spawn loop

`init_parent_huffin_puffin` (Bank0E:4619, `$0EA472`):

1. `$7A36,x = $0100` (initial scale).
2. `JSL CODE_03AE60` (sprite engine helper).
3. **SuperFX collision scan**: run `FXCODE_0991D5`. After return,
   `R6 - 6 -> A`. If `BPL` (positive), `CMP #$FFFE BPL` cap to
   `$FFFE`.
4. `EOR #$FFFF; INC -> $00` (negate; turns positive max
   chick-count into a DEC loop).
5. `$02 = $0010` (initial Y offset for first chick).
6. **Chick spawn loop** (CODE_0EA4A4):
   - `$04 = Y` (save parent slot index Y).
   - `LDA #$0028 JSL CODE_spawn_sprite_active` -- spawn chick.
   - On failure -> exit loop.
   - Copy parent X/Y/`$7400` into chick.
   - `$02 -> chick's $7A96` (initial Y position offset).
   - `$02 += $0008` (next chick's offset).
   - Copy parent's `$7974` (a per-frame timer cache) into chick's
     `$7A38`.
   - `SEP #$20; TXA STA chick's $701978` (chick's parent-slot
     reference = parent_X reg).
   - `$04 -> chick's $701979` (chick's parent-slot reference high).
   - DEC `$00`, loop while non-zero.
7. `JSR CODE_0EA57E` (per-frame draw - run once in Init).
8. `$7974 -> $7A38,x` (cache the per-frame timer base).
9. RTL.

So the chick count is **at most** `R6 - 6` (capped to FFFE+2 = 2,
the minimum). The collision scan's R6 return determines how many
chicks the parent has available. The vertical-strip arrangement
gives chicks `$0010, $0018, $0020, ...` as their per-chick
`$7A96` (a sub-state timer that controls jump-launch staging).

### 21.3 Mother $0F6 -- 4-state Main

`DATA_mother_huffin_puffin_state_ptrs` (Bank0E:4682):

| `$76` | Handler | Behavior |
|---|---|---|
| 0 | `CODE_0EA675` | Idle / breathing (not deep-traced). |
| 1 | `CODE_0EA70E` | Lay-eggs (additional chick spawn?) (not deep-traced). |
| 2 | `CODE_0EA745` | Panic / wing-flap (not deep-traced). |
| 3 | `CODE_0EA768` | Despawn (not deep-traced). |

`main_parent_huffin_puffin` (Bank0E:4692) per frame:

1. `CODE_0EA519` -- pre-dispatch sprite-draw helper.
2. `JSL CODE_03AF23` (engine housekeeping).
3. `CODE_0EA533` -- two SuperFX calls of `FXCODE_0B86B6` (sine
   helper) at scale `$7A36`: one with R0=$0010 (frame Y-bob),
   one with R0=$000A. The second result goes into `$7BB8`
   (sprite-render extent / bob).
4. `STZ $0E` (per-frame work cache reset).
5. Dispatch via `(DATA_mother_huffin_puffin_state_ptrs, $76 * 2)`.
6. `CODE_0EA57E` -- post-dispatch sprite draw, running
   `FXCODE_088295` (the actual SuperFX render call with R12 =
   FXDATA_550000+$2000 / R8 = $0010 scaling).
7. `CODE_0EA5D5` -- per-frame Yoshi-collide handling: if
   `$7D36 BMI`, BEQ skip; if `$6EFF,y == $0010` AND `$7D37 !=
   0`, TYX + `JSL CODE_03B25B` (mother kills the threat).
   Else if positive `$7D36`: standard sprite-on-sprite damage.
8. RTL.

### 21.4 Chick $028 -- the boomerang-throw mechanic

`init_huffin_puffin_running` (Bank0E:5017) = `RTL` only.

`main_huffin_puffin_running` (Bank0E:5044, `$0EA792`) per frame:

1. `LDA $7D38,x BEQ CODE_0EA7B1` -- if hit-flag clear, jump to
   normal-run path.
2. Store `$7D38` -> `$701902,x` (cache hit-state).
3. **Boomerang detection**: `LSR BNE CODE_0EA7B4` -- if not
   exactly `$0001`, branch to standard-flight path. Else:
4. **Boomerang return setup**:
   - Check `$7D36 BPL` (no current Yoshi-hit), `$7A36 ORA
     PlayerCurrentForm BEQ` (no special form interaction).
   - Zero `$7D38,x` (clear the boomerang trigger).
   - `JSL CODE_03BEB9` (the boomerang-return arm).
5. After arm: branch to `CODE_0EA898` (main physics integration).
6. Standard-flight path (CODE_0EA7B4):
   - If `$7542 >= $0040` (in mid-throw arc), branch to
     CODE_0EA898 directly (just keep flying).
   - Compute throw-angle vector to player via `FXCODE_0BBCF8`
     (the angle-to-player helper): pass `$7C16, $7C18`
     (X,Y delta to Yoshi) -> SuperFX R1, R2 -> returns R0 =
     angle.
   - If `$0B57 == 0`: `R0 ^= $0100` (mirror angle for
     screen-mirrored levels).
   - `BIT $701900,x BMI`: if anchor angle stored, branch.
     Else `EOR $00FF INC AND $01FE` (negate angle).
   - SBC `$701900,x` (delta from anchor); AND `$01FE`
     into `$00`. If `>= $0080`, branch to per-direction adjust.
7. **Angular increment**: `LDA $701900,x CLC ADC DATA_0EA786,y`
   where `DATA_0EA786 = $0006, $FFFA` (advance angle by +$6
   or -$6 per frame). AND `$01FE`. Store back to `$701900`.
8. **Sine/cosine lookup**:
   - `TAY` (Y = angle).
   - Read `DATA_sine_lut_8bit_radians[X = angle]` ASL ASL.
   - On BPL: `Y = 2` (cosine sign flag). On BMI: `Y = 0`.
9. **Compose velocity** (`DATA_0EA78A = $FFB0, $0050, $FC00, $0400`):
   - Read sine -> `$02` (the Y-velocity component).
   - Read cosine -> use as the X-velocity component.
   - For each velocity (X then Y): compute delta against current
     `NorSpr_XSpeedLo` / `NorSpr_YSpeedLo`; on sign mismatch
     EOR `Y ^= $0002` (flip into opposite-direction case);
     pick `DATA_0EA78A[y]` ($FFB0, $0050, $FC00, $0400 = small
     X / large X / large Y-down / small Y-up tweak) and add
     to the current speed.
10. RTL via `CODE_0EA898` (physics integration via `JSL
    CODE_03B9DD`) then through the 3-state dispatch:

`DATA_huffin_puffin_chick_state_ptrs` (Bank0E:5029):

| `$76` | Handler | Behavior |
|---|---|---|
| 0 | `CODE_0EA8FC` | Run (not deep-traced). |
| 1 | `CODE_0EA96A` | Jump (not deep-traced). |
| 2 | `CODE_0EA9EF` | Land (not deep-traced). |

The boomerang-return mechanic is **distinctive among YI sprites**.
A chick swallowed and thrown by Yoshi reads its throw-angle each
frame and applies sine/cosine drift to converge back toward Yoshi.

### 21.5 Cross-references

- `yi/Banks/Bank0E.asm:4619-5198+` -- the full Huffin Puffin family.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $028 / $0F6.
- SuperFX entry points: `FXCODE_0991D5` (parent collision-scan),
  `FXCODE_0B86B6` (sine helper), `FXCODE_088295` (parent draw),
  `FXCODE_0BBCF8` (angle-to-player helper).
- `DATA_sine_lut_8bit_radians`, `DATA_cosine_lut_8bit_radians`
  (in Bank03 -- the standard 8-bit-radian sine table).

---

## 22. Georgette Jelly pair ($111 Slime / $112 Goo)

A 2-sprite pair: a wobbling slime body ($111) that, on egg/sprite
hit, splits into droplet sub-sprites ($112). Slime body is **self-
pairing** via `$701900` and `$701902` -- when those two slots match,
the slime decrements `$701900` and starts state 0 (i.e., it
"reforms" by re-anchoring itself). World 6 levels are the primary
spawn site.

Lives in `yi/Banks/Bank01.asm` lines 4561-5261.

### 22.1 ID table

| Sprite ID | Constant | Init handler | Main handler | StompRt | Role |
|---|---|---|---|---|---|
| `$111` | `GeorgetteJelly` | `init_flan` Bank01:4561 | `main_flan` Bank01:4597 | head-bop hit | World 6 wobbling slime (reformable). Init self-pairs via `$701900` / `$701902`. Main runs freeze-aware SuperFX damage scan via `CODE_georgette_jelly_per_frame_l`, dispatches 6-state machine via `DATA_01A5E0`. Picks OAM size $0620 (small) or $0660 (large) based on `$76 < $02`. |
| `$112` | `GeorgetteJellyGoo` | `init_jelly_goo` Bank01:5208 | `main_splashed_flan` Bank01:5225 | (passive) | Droplet spat off Georgette Jelly. Init = `RTL`. Main 2-state: state 0 = INC `$76` (1-frame settle); state 1 = arm drag (`$7542 = $0020`, `$7A98 = $0008`), step animation frame `$7402` from 0 to 2, despawn on `$7860 & 1` (ground-hit) via `JML CODE_03A31E`. |

### 22.2 Slime $111 -- self-pairing Init

`init_flan` (Bank01:4561, `$01A5C9`):

1. `LDA $701900,x CMP $701902,x BNE CODE_01A5DF` -- if the two
   self-pair slots are equal (i.e., the slime has been reformed
   or just placed by level data), advance setup.
2. `DEC $701900,x` -- now mismatch the pair (so subsequent re-init
   from a despawn will detect it).
3. `STA $76,x` (where A is still the matching value) -- preserve
   the pair-state byte into $76.
4. `$7A98,x = $0002` (per-frame timer).
5. `INC $7402,x` (advance facing/anim by 1).
6. RTL.

The self-pair mechanic: when the slime is placed at level load,
level-loader sets `$701900 = $701902` (matching). Init detects
this, advances initial state, then misalignes the pair for next
time. When the slime is killed (despawn), the slot is freed and
the pair is implicitly broken; on respawn (re-entering the
sprite's spawn zone), the pair matches again -> Init re-arms.

### 22.3 Slime $111 -- Main + 6-state machine

`DATA_01A5E0` (Bank01:4577):

| `$76` | Handler | Behavior |
|---|---|---|
| 0 | `CODE_01A830` | (Walking / idle; not deep-traced.) |
| 1 | `CODE_01A889` | (Small slime motion; not deep-traced.) |
| 2 | `CODE_01A8C0` | (Large slime motion; not deep-traced.) |
| 3 | `CODE_01A8F2` | (Reform / merge; not deep-traced.) |
| 4 | `CODE_01AA1F` | (Defeat / splatter; not deep-traced.) |
| 5 | `CODE_01AA6B` | (Final cleanup; not deep-traced.) |

`main_flan` (Bank01:4597, `$01A5EC`) per frame:

1. `JSL CODE_georgette_jelly_per_frame_l` (Bank01:4617) -- this
   is the **freeze-aware SuperFX damage scan**:
   - If `FreezeSpritesFlag != 0` OR `TouchedFuzzyMosaicTimer != 0`
     OR `ItemBeingUsed != 0`, **pull the caller via PLY/PLA**
     and `RTL` -- the slime is paused.
   - Else run `FXCODE_099011` (per-sprite damage scan).
   - For each sprite slot in `R14` (returned register loop):
     check `CurrentStatus == $0010` (active), `$6FA2 & $0800
     == 1` (slime-killable). Skip TapTap variants ($109/$10A/$10B).
     For each valid slot: kill via `CODE_03B24B`, set `$7540 = 0`,
     `$YSpeed = $FE00` (knockback up), `$7542 = $0040` (recoil
     timer); `JSL CODE_03B53D` (impact effect).
2. `JSR CODE_01A740` -- per-frame egg/projectile damage detector +
   Yoshi bounce/mount logic.
3. `TXY; LDA $76 ASL TAX; JSR (DATA_01A5E0,x)` -- dispatch state.
4. **OAM-size pick**: if `$76 < 2`, OAM-attr = `$0620` (small);
   else `$0660` (large). Store into `$6FA0,x`.
5. RTL.

### 22.4 Goo $112 -- droplet despawn

`init_jelly_goo` (Bank01:5208) = `RTL` only -- parent populates.

`main_splashed_flan` (Bank01:5225, `$01AA9E`) per frame:

1. `JSL CODE_03AF23` (engine housekeeping).
2. `LDY $76,x BNE CODE_01AAA9` -- state 0: INC `$76` -> RTL.
3. **State 1**: if `$7A96 != 0` (still in initial-settle):
   - `Y = $18` (sub-state). If 0: arm `$7542 = $0020` (drag),
     `$7A98 = $0008` (anim-timer); INC `$18`.
   - If `$7A98 == 0`: re-arm `$7A98 = $0008`; if `$7402 < 2`,
     INC `$7402`.
4. `$74A2,x = $0006` (palette setup).
5. `LDA $7860,x AND $0001 BEQ` -- if not ground-hit, RTL.
6. Else `JML CODE_03A31E` (despawn on ground-hit).

### 22.5 Cross-references

- `yi/Banks/Bank01.asm:4561-5261` -- the full Georgette Jelly pair.
- `yi/Memory/WRAM_Buffers.asm` -- `$701900` / `$701902` (the
  self-pair slot bytes).
- SuperFX entry points: `FXCODE_099011` (per-sprite damage scan
  for the slime).
- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $111 / $112.

The slime's freeze-aware Main is **the only sprite-Main in YI**
that does a full pull-caller-and-RTL when freeze conditions are
set; most freeze-handling lives in the engine layer rather than
per-sprite. The TapTap-exclusion in the damage-scan loop is
notable too: the slime can't kill TapTap variants ($109/$10A/$10B)
because TapTaps have their own slime-resistance in their OAM
attribute table.

---

## 23. Round-8 individual oddballs

Twenty-seven additional single-sprite enemies and props that don't
cluster into any of the named family docs.  Each entry below is a
compact paragraph -- Init+Main addresses, state machine summary, and
the one or two genuinely interesting behavioural details. Entries are
grouped loosely by role (mechanism / FX / enemy / stub). Three
glitched-stub IDs and four already-aliased IDs share an entry at the
end.

### 23.1 $004 HitSuperBabyMarioBlock (`init_star_item` Bank02:4950 / `main_star_item` Bank02:4964)

The bumper block that pops a Super Star $1A2 when Yoshi hits it from
underneath. Init caches the spawn Y into `$18,x` (so Main can detect a
return to floor) and seeds an upward `YSpeed = $FD80`. Main is
state-less: on the first frame after Y-speed goes positive (the block
has reached apex and started falling), it tries to spawn a Super Star
above via `CODE_spawn_sprite_init` -- but only if
`!RAM_YI_Level_StarTimerLo >= !Define_YI_Level_SoftMaxStarTimerThreshold`
(plenty of star-power runway left) AND `($10 & $0007) == 0` (a
1-in-8 master-clock gate). When that lottery loses or fails to find a
free slot, the fallback path at `CODE_02AD48` calls `CODE_03A4E9` with
$0004 (treats the bump as a coin pickup) and plays
`SoundID09_Coin`. After bouncing back below spawn-Y, Main rewrites the
Map16 tile at the spawn coords via `CODE_change_map16` ($8A00 source)
and despawns -- so the block visibly turns into a "spent" tile after
a single use.

### 23.2 $01F RotatingDoors (`init_rotating_doors` Bank0F:953 / `main_rotating_doors` Bank0F:1041)

The Bowser-castle spinning-door divider: a central pivot with 8 paired
spokes that rotate as a unit. Init at Bank0F:953 first spawns a
**partner $01F slot** in the same X/Y (the partner Inits with status
$02 to skip its own setup), then enters a `DO 8 TIMES` loop
(`CODE_0F873C` ... `BNE CODE_0F873C` at line 1014) spawning eight
$01F arm-children with seeded angle (`$7019D8 = DATA_0F86E1,y`) and
frame index (`$7402 = DATA_0F86E6,y`). Each arm caches its index byte
in `$701900` (8/6/4/.../0) which Main uses as the 5-entry dispatch
selector at `DATA_0F879E`. The spin counters live in level-scope WRAM
at `$105C..$1064` (per-arm rotation accumulators); only one rotating-
doors instance can exist per room. Main dispatches first on
`$701900,x` (variant 0 = root, others = arm), then on `$79,x` (a
4-entry state ptr `DATA_rotating_door_state_ptr` -- idle / begin-spin
/ mid-rotation / commit-room-transition) for the root slot only.

### 23.3 $037 GrimLeecher (`init_grim_leecher` Bank04:4136 / `main_grim_leecher` Bank04:4164)

The ghostly enemy that latches onto Yoshi and drains his timer. Init
seeds `$701900 = $0008` (an active-phase counter, unused by any other
sprite) and `$7A38 = $0100` (initial Y-anchor offset). Main dispatches
on `$76,x` ASL'd through `DATA_grim_leecher_state_ptr` (Bank04:4148,
**7 entries**: idle-seek / hop-at-yoshi / mounted-drain / dismount /
fly-away / settle / cleanup). The mount transition is the genuinely
interesting bit: state 1 (`CODE_049EAF`) reads `$7D36` (touch-link to
Yoshi) and if positive, sets `!CurrentStatus = $000A` (custom "mounted"
status, distinct from the standard $0010 alive), writes its own slot
index into `$7E48` (the global "leecher-mounted" interlock, read by
the level engine to keep the drain visible across the HUD), and
freezes Yoshi's mouth-input via `$0CC8 = $0020`. State 2
(`CODE_049F6E`) then runs the actual drain -- one of the few sprites
to use **half-rate Y-bob via signed `LSR` of `$7A38`** rather than a
sine-table lookup. Unlike most oddballs, `$037` has its **own
RideYoshiRt at Bank04:4497** (label `YI_NorSpr037_GrimLeecher_RideYoshiRt`)
rather than sharing the empty 03:9A6B stub -- because the slot needs
to render every frame while Yoshi rides it.

### 23.4 $07E DentOfSquishyPlatform (`init_invisible_slime_platform` Bank02:2075 / `main_invisible_slime_platform` Bank02:2086)

The invisible tracker sprite that drives the castella/slime block
deformation. Init falls **through** into Main (no RTL gap) -- one of
only a handful of YI sprites that share its Init+Main routine bodies.
Init at Bank02:2075 saves the three computed BG3 anchor coords (from
shared helper `CODE_0297F3`) into `$7A38 / $701900 / $701902`. Main
then computes the dent depth as `$7182,x - YI_Player_YPosLo` plus a
per-state DATA_029617 offset table, clamps to 8 pixels, and writes
back a SuperFX `R6 = $76,x` multiplier-feed plus three
`CODE_029818` Map16-rewrite calls (one per saved anchor). The result
is a real-time deformation of three BG3 tiles tracking Yoshi's
vertical sink into the block. When the dent fully sinks, the routine
plays the HeadStuck SFX (queue handled by `CODE_03A31E` despawn path).

### 23.5 $07F LogSeesawPlatform (`init_log_seesaw_platform` Bank04:6108 / `main_log_seesaw_platform` Bank04:6126)

The log-on-a-pivot platform that tips toward whichever side Yoshi
stands on. Init runs the standard floor-snap (`CODE_03AE60`), the
BG3-spawn helper `CODE_04AE9D`, then writes `$701900 = $2000` (the
initial angular position -- 0x2000 of a full $10000 turn = mid-arc).
Main calls the shared lean-direction helper `CODE_04AEDF` (used by all
seesaw-family sprites including $03D LargeSeesaw), reads back `$7A39`
(quadrant byte) and uses the value to index into `DATA_04ACCB / 04ACCF`
(two 2-entry tables for X-velocity and side selector). The pivot
transform is then applied to OAM via `FXCODE_0B855B` (Bank04:6159) and
the OAM stamps are computed by reading the multiplier latch
`!REGISTER_SuperFX_R0` back into per-tile `$00 / $02 / $04` offsets.
This is the same `FXCODE_0B855B` chain $03D uses; the difference is
that $07F's log is a 4-tile narrow plank, not the 8-tile wide platform
of $03D, so the per-tile loop bound (`$0A`) differs.

### 23.6 $082 ChainChomp (`init_chain_chomp` Bank05:2563 / `main_chain_chomp` Bank05:2642)

A standalone hazard with no family kin in `family-fish.md`. Init at
Bank05:2563 calls `CODE_03AE60` then writes the four chain-segment
X-positions to `$0DFD..$0E03` and Y-positions to `$0E05..$0E0B` -- all
**level-scope WRAM** (not `,x` indexed) -- plus the anchor cache to
its own `$701900 / $701902` EXRAM. **This per-level-scope chain state
means only ONE Chain Chomp can be alive per room**; a second slot would
overwrite the first's chain. The 6-state dispatch at
`DATA_chain_chomp_state_ptr` (Bank05:2597) walks idle / windup /
snap-shut / chain-retract / lunge / recoil. The Main routine wraps the
state dispatch with a **per-segment rumble-jitter loop**
(`CODE_chain_chomp_rumble_loop` Bank05:2685, gated on
`$0E11 != 0` ground-clip timer): each of the 4 OAM segments gets a
0/+1 pixel X/Y nudge from `$10` RNG bits while airborne, giving the
visible body-shake.

### 23.7 $08F MonkeySwing (`init_swing_of_grinders` Bank05:3497 / `main_swing_of_grinders` Bank05:3517)

A central anchor with two rotating grinder children on opposite
ends of a swinging arm. Init at Bank05:3497 calls `CODE_03AE60`
**twice** (the comment notes the second pass is "extra slots" --
the two child OAM stamps) with `$7722` snapshotted into `$18` between
passes for orbit phase. Seeds `$75E0 = $75E2 = $FE40` (the orbit
radius for both grinders) and `$7A36 = $7A38 = $8000` (the half-cycle
phase offset). Main calls helper `CODE_0597A9` (Bank05:3542) which
sets up `R7 = R1 = $7A37 ASL` and `R5 = $7A39 ASL` (angle pair) then
invokes **`FXCODE_0B950A`** -- the SuperFX SIN/COS plotter that
returns rotated X+Y offsets in `R0/R5`. Three sequential
`CODE_03AA60` calls (Bank05:3577, 3588, 3594) stamp the central
anchor and the two grinder ends at +$20 / +$40 / +$60 OAM offsets,
sharing `$7722` between calls to redirect the OAM index. The two
grinders thus orbit on a perfect circle (radius $FE40) anti-phase from
each other.

### 23.8 $092 MelonBug (`init_melon_bug` Bank05:16283 / `main_melon_bug` Bank05:16296)

The pill-bug enemy that rolls into a ball when threatened. Init is a
bare RTL. Main dispatches on `$76,x` ASL'd through the 3-entry
`DATA_melon_bug_state_ptr` (walk / roll-into-ball / rolling-post-roll).
The rolling state is the interesting bit: when a Yoshi-controlled
sprite slot ($022..$02B egg flavors and $107 seed) collides with the
bug (state $00, `$7D36` link, `$7D38` held-flag both set on the
attacker), Main at Bank05:16344 reads the attacker's XSpeed, **clamps
it to [-$0300, $0300]** at Bank05:16346-16352, then transfers the
clamped velocity into the bug's own XSpeed and forces state $02. The
bug then **carries the egg's velocity as a rolling-ball deflection**
-- exactly the gameplay-visible "reflects projectiles" behaviour. On
non-projectile contact (`CODE_05FA21`) the bug plays SoundID62
(MelonBugBump), arms a $10-frame lockout `$7AF6`, and enters state 2
directly without inheriting velocity.

### 23.9 $09C Mace (`init_mace` Bank04:10490 / `main_mace` Bank04:10506)

The spiked-mace child of a $09B MaceGuy, attached via slot-link in
`$18,x`. Init at Bank04:10490 only calls helper `CODE_04D4E7`
(populates per-orbit phase from parent). Main dispatches on `$76,x`
through the **2-entry** `DATA_mace_state_ptr` (orbit-parent /
detached-fly). Each frame Main first re-verifies the parent link
(`$18,y` sprite-ID == $09B, parent alive). When the parent dies
(`!CurrentStatus == $0010` flip), Main at Bank04:10519 takes the
detach path: computes a sign-aware velocity from `$7A38` (orbit angle)
through `FXCODE_0B86B6` (cos/sin plotter), writes the result to
`XSpeed`, seeds `YSpeed = $FF00`, sets a $40-frame stagger via $7542,
clears the parent link `$18`, and enables damage bits `$7040 |= $0008`.
The orbit-state branch at `CODE_04D31D` (still parent alive) just
copies `$70E2,y - $70E2,x` into `$16,x` (X-delta to parent) and
similarly for Y into `$75E0,x` -- so the mace tracks the parent's
movement laterally while the orbit math computes the rotational
offset.

### 23.10 $0A0 Tulip (`init_tulip` Bank0C:9540 / `main_tulip` Bank0C:9568)

The flower-pot egg-eater dispenser. Init guards via `CODE_03D3F8`
(level-flag "already-spawned" check, common with Bonus rooms) and
either despawns or proceeds: seeds `$18 = $7A36 = $7A38 = $0100`
(initial lip parameters), calls helper `CODE_0CCC22` then
`CODE_0CC969` to settle the OAM tilemap. Main dispatches on `$76,x`
through the **7-entry** `DATA_tulip_state_ptr` (closed / open / catch
/ chew / spit / refuse / despawn). The catch state at `CODE_0CC9B9`
contains a **deterministic random-payload selector**: it reads
`!RAM_YI_Level_StarTimerLo`, divides by $0A using hardware
`!REGISTER_DividendLo / Divisor`, and (after the 8-cycle multiplier
latency `NOP #8`) reads the remainder out of `!REGISTER_QuotientLo`,
storing `$1E - remainder` into `$701903`. So the apparent random
spit-payload is keyed entirely to whatever value StarTimer happens to
hold at the catch moment -- the same star-timer-mod-10 pattern used by
the Goal Ring spin (docs/family-cinematic.md). The dispatcher at
`CODE_0CCA44` then branches on the sign of `$701903`: spit a $115
Coin / $0FA Flower with one set of XY offsets, or a $1A2 Super Star
with another.

### 23.11 $0A1 SmallPot + $031 PottedSpikedFunGuy (Bank04)

A bonded pair via shared `$7A38` back-pointer. **$0A1 SmallPot**
(`init_pot_of_potted_spiked_guy` Bank04:3952 = bare RTL,
`main_pot_of_potted_spiked_guy` Bank04:3968) is a near-passive
carryable: Main checks for stunned-status `$0008` AND
`$7A38 != 0` (pair-bond exists) and on hit calls helper
`CODE_049DFC` to break the pot. **$031 PottedSpikedFunGuy**
(`init_potted_spiked_guy` Bank04:3783 / `main_potted_spiked_guy`
Bank04:3840) is the spiked-shy-guy hidden inside. Init at Bank04:3800
either spawns a $0A1 SmallPot via `CODE_spawn_sprite_active`
(saving the spawned slot Y into the guy's `$7D36`, and X into the
pot's `$7A38` so the pair can find each other) OR -- if the
$70E2 X-bit-4 is clear and the level data doesn't request a pot --
skips the spawn (`CODE_049BB7` path) and starts walking directly
exposed. The state machine is small: 2-entry
`DATA_potted_spiked_guy_state_ptr` (idle-inside-pot / emerge-walk),
where state 0 is the **shared shy-guy TYX/RTS stub** at $048000
(`CODE_shy_guy_state_05_stub`) -- the guy renders nothing while in
the pot, then state 1 emerges and walks via X-speed from
`DATA_049BA6` indexed by facing `$7400`. Pot-break is signalled to
the spiked guy via the pot's $7D36 hold-link going clear; the guy
then despawns via `CODE_03A5B7` (the shared inactive-cleanup path).

### 23.12 $0E6 Gusty (`init_gusty` Bank01:5504 / `main_gusty` Bank01:5588)

The white wind-spirit enemy, with TWO roles selected by `$7182` bit 4
at Init time. **Generator role** (`$7182 & $0010 != 0`): Init at
Bank01:5507 snaps Y to 32-pixel grid, picks an X-spawn pattern from
DATA_01AC8A indexed by `$70E2 bit 4`, sets invincibility `$74A2 =
$00FF` plus tile-overlay bits `$6FA0 = $0060`, marks `$76,x = 1` (the
"I am a generator" flag) and increments the global
`!RAM_YI_Level_NorSpr_GustyGeneratorActiveFlagLo` (so only one
generator runs per level). **Float role** (the inverse): Init checks
camera-relative X via $6094 delta against bit 4, despawns immediately
(`CODE_03A31E`) if Yoshi is on the wrong side, else falls through to
`CODE_01ACF9` which seeds X-speed from DATA_01AC7A and anim-frame from
DATA_01AC82. Main at Bank01:5588 dispatches on `$76,x` -- 0 (float)
takes the contact/animation path with floor-bonk recoil at line 5642
and the SoundID42 trigger; 1 (generator) loops at line 5668 spawning
one Gusty child every $0100 frames (`$7A96` countdown) at the saved
X/Y, decrementing the global flag when the generator's
camera-relative position scrolls off-screen.

### 23.13 $0F1 EggPlantShootingBubbles (`init_bubble_plant` Bank07:66 / `main_bubble_plant` Bank07:92)

A decorative plant variant that periodically spits a Bubble ($019).
Init seeds `$7A98 = $0006` (6-frame sub-counter) and `$7A96 = $005A`
(90-frame cooldown to first spit). Main runs three nested timers: top-
level `$7A96` cooldown, mid-level `$7AF6` per-anim-pose hold, low-
level `$7A98` sub-frame timer. When `$16,x` hits step 4 (the firing
pose), Main spawns a `$0019 Bubble` at Y-offset -$0018 (above the
plant) with `YSpeed = $FF00` (gentle upward drift) and `$7402 = $0004`
+ `$7A98 = $000A` so the spawned bubble takes its own pulse cadence
into Bank04:760. **V1.0 vs V1.1 divergence**: the spawn call uses
`CODE_spawn_sprite_init` on U2 and `CODE_spawn_sprite_active` on
U1 (Bank07:136-140, `if !ROM_YI_U2`); the difference is that
spawn_sprite_init runs the spawned sprite's Init synchronously
inline, while spawn_sprite_active just marks the slot active for
next-frame dispatch -- a frame-timing bug in V1.0 that the V1.1
re-release fixed.

### 23.14 $121 NumberPlatformExplosion (`init_number_platform_explosion` Bank04:9610 / `main_number_platform_explosion` Bank04:9621)

The 4-tile numbered-platform shatter VFX (used when a numbered
counting block hits zero). Init is a bare RTL. Main is a **one-shot
state machine** -- `$76,x == 0` increments to 1 and returns (one-frame
delay), then on the second frame branches on `$61B4` (the global
"map16-change is pending" semaphore): if it changes during the
`JSL CODE_03D22D` call, the routine aborts (`BNE CODE_04CCAC`) to
avoid double-fire. On the live path it plays SoundID3B_Pop, spawns
the ambient puff sprite $1E6, then loops `$00 = 4` times through
DATA_04CC25 (a 16-entry table arranged as four 4-tile pairs --
`$0000,$0000,$0000,$0000,$7600,$7601,$7775,$7776,...`) writing each
Map16 tile via `CODE_change_map16`. The `$18,x` byte selects the
base offset into DATA_04CC25 (ASL'd three times = `*8`), so 4
variants of post-shatter tile layout exist (selected by whoever spawns
this sprite).

### 23.15 $12E LargePopEffect (`init_large_pop_effect` Bank06:6298 / `main_large_pop_effect` Bank06:6327)

The big "POP!" particle burst spawned when something large breaks.
Init is bare RTL. Main has TWO unusual side-effects per frame: (1) it
**recenters Layer3 BG**: `!RAM_YI_Global_Layer3XPosLo = $0180 - $7680,x`
(camera-relative center subtraction) and same for Y -- this snaps the
Layer3 background to the sprite-position so the POP graphic appears
centered on whatever it spawned over. (2) it **enables color-math**:
forces `$001B + $0400` into MainScreenLayers and `$33` into
ColorMathSelectAndEnable each frame -- producing the saturated white
flash visible in the actual effect. Anim advances through DATA_06B940
/ DATA_06B946 (two 6-entry frame tables, selected by `$16,x`) with
`$18,x` as the sub-counter; when `$18,x` underflows past 0 and `$76,x`
underflows from `BPL` test, the sprite zeros Layer3 scroll
(`STZ $6098 / $60A0`) and despawns. Failing to zero Layer3 would leave
the BG offset stuck.

### 23.16 $019 Bubble (`init_bubble` Bank04:733 / `main_bubble` Bank04:760)

The underwater air-bubble. Init is bare RTL (spawn parent seeds all
state). Main is the most table-driven oddball in this batch: per
frame it ticks `$7A96` (size-pulse timer) and `$7A98` (lifetime
counter), branching on three lookup tables -- `DATA_0484C1`
(22-entry radius pulse table, scanned by `$7A98 LSR`),
`DATA_0484ED` (8-entry X/Y offset pairs for the wobble nudge), and
`DATA_0484FD / 0484505` (4-entry spawn-direction + launch-velocity
pairs). The wobble uses the engine's `!EXRAM_YI_Global_RNGOutputLo`
to pick which entry of `DATA_0484ED` to add to current X-speed; a
sign-flip on the result re-seeds the next pulse via `$7A96 = $0030`.
Lifetime expiry (`$7A98 == 1`) routes to `CODE_03A31E` despawn after
zeroing XSpeed. Spawn parents include $0F1 (egg-plant bubbles), $181
(Crazee Dayzee), and various boss/cinematic spawners; the same handler
serves all of them.

### 23.17 $01C DrFreezegood (`init_freezegood` Bank05:10190 / `main_freezegood` Bank05:10243)

The snowman ice-shooter. Init has two paths via `$77,x` (an unusual
register -- the parent-link byte): non-zero means a parent (likely
$01D DrFreezegoodOnSkiLift) is spawning this slot, so the routine
verifies the parent is alive via `CODE_03AD74` and on the death-path
clears parent's `$7A38 = 0` and despawns; zero means standalone-spawn,
calls `CODE_03AE60`, runs helper `CODE_05CC2E`, and snapshots spawn
XY into `$701900 / $701902` (used later by the ground-snap reset). A
**level-context palette branch** at Bank05:10215 then derives `$18,x`
(palette/tile-offset byte) from the tile XY bits -- `($70E2 AND $10)
LSR 3 ORA ($7182 AND $10) LSR 2` packs both bits into a 0/1/2/3
nibble. Main dispatches on `$76,x` through the **3-entry**
`DATA_freezegood_state_ptr` (skis-along-ski-lift / skis-on-ground /
hit-disabled). The "freezes Yoshi in place" gameplay is in the
projectile child (which $01C spawns via the throw state) -- $01C
itself just produces ice as a thrown sprite slot.

### 23.18 $059 StationarySuperStar (`init_super_star_continuous` Bank02:2443 / shared Main Bank02:2507)

The hanging Super Star variant in Star Mario challenge rooms. Init at
Bank02:2443 first checks `!EXRAM_YI_Player_CurrentFormLo`: if
already in `PlayerForm10_SuperBabyMario`, falls through into the
**shared $088 SuperStar Init** body at `CODE_02989E`, which runs the
$0100 zoom-render via FXCODE_088619 (the spiral-twinkle scroll
effect). If Yoshi is NOT Super yet, sets `!CurrentStatus = $0002`
(pending) plus `$74A2 = $00FF` (invincible/sparkle palette) and RTLs
-- the star hangs there inert. Main at Bank02:2507 is shared with
$088: dispatches a 2-entry `DATA_super_star_state_ptr` (idle-pickup /
transform-to-SuperBabyMario). State 0 polls `$7D36` for Yoshi-overlap
and checks Yoshi's current form: if zero (not super), kicks off the
intro SFX path `CODE_0298E8` (plays SoundID30 + Bank04:18046 init);
if already super, just plays SoundID27_CollectSuperStar + despawns.
So `$059` is a "factory" that re-spawns the same SuperStar each time
Yoshi enters its room, while `$088` is the single-pickup variant
spawned by $004 HitSuperBabyMarioBlock.

### 23.19 $063 MuddyBuddy (`init_muddy_buddy` Bank05:13438 / `main_muddy_buddy` Bank05:13466)

The mud-throwing floater. Init runs `CODE_03AE60` then seeds
`$7A36 = $7A38 = $0100` (the cosine/sine multipliers for the
FXCODE_0B86B6 orbit math) and calls helper `CODE_05E63A` to settle
OAM. Main dispatches on `$76,x` ASL through the **10-entry**
`DATA_muddy_buddy_state_ptr` (idle / shared-1 / charge / throw /
shared-4 / recover / hit-stun / drift-7 / shared-8 / defeat). States 1
and 4 are both `CODE_05E75E`, and 7-8 both `CODE_05E898` -- two pairs
of state-aliasing. The really notable bit is the per-frame
**SuperFX-driven body deformation loop** at `CODE_05E3EE`
(Bank05:13549): iterates 2 OAM stamps, for each one reads
`$6020,y` (the rendered Y), subtracts $00 (the radius accumulator),
loads $7A36 into R6, runs FXCODE_0B86B6 (cos plot), and writes the
result back to `$6020,y` plus +$0008 -- producing the visible
"swaying" body wobble. The hit-stun state uses
**FXCODE_099011 + 09906B** for collision -- the same crystal/freeze-
test pair used by $006 WatermelonFreeze.

### 23.20 $132 LemonDrop (`init_lemon_drop` Bank06:2461 / `main_lemon_drop` Bank06:2495)

The yellow stalactite-drip enemy in W3 yellow-cliff caves. Init writes
`$76,x = $05` (the fall phase) and RTLs -- this seeds **directly into
the mid-table state**, not state 0. The 11-entry
`DATA_lemon_drop_state_ptr` is split into two halves: entries 0-5
cover form-up / drop / splat / despawn for the falling drop, entries
6-A cover the **post-bounce mirror sequence** (form / drop / splat /
post-splat / cleanup, with entries 6 and 7 reusing entries 0 and 1's
handlers `CODE_0694F0 / CODE_069531`). The duplication exists because
a falling drop can hit a tile, bounce, then drip again -- the two
state-table halves keep separate timing/anim state for the airborne
vs post-bounce phases. Yoshi-touch from above (`$7D36 < 0`,
`$7C18,x - $6122 - $7BB8,x` Y-bounds check) triggers spike-death via
`CODE_03A858` damage routine.

### 23.21 $161 RewardItemForDefeatingRoomEnemies (`init_bonus_sprite` Bank0F:2601 / `main_bonus_sprite` Bank0F:2630)

The Coin/Key/Flower/Door reward that drops after Yoshi defeats every
enemy in a defeat-all bonus room. Init guards via `CODE_03D3F8`
(despawn-if-already-claimed flag) then packs the spawn tile
coordinates into `$701900`: `(70E2 & $10) >> 3 | (7182 & $10) >> 2`
-- a 4-value packed nibble (0/1/2/3) that picks the variant. Main at
Bank0F:2630 calls **FXCODE_09AF4A** (the descent FX with terrain
probe), checks `R11 < 0` (signed flag: terrain hit), and when it
fires plays SoundID95_BonusChallenge + `JSL CODE_039F2B` (camera
shake / freeze), then reads `DATA_0F92D9[$701900]` to pick one of 4
sprites: `$115 Coin / $027 Key / $0FA Flower / $093 Door` (the 4th
entry continues past the table edge -- see source at Bank0F:2656).
The variant index `$701900` is also used as a second-level
dispatch into `DATA_0F92E1` for the per-reward post-spawn animation.

### 23.22 $199 DizzyDandy (`init_dizzy_dandy` Bank0C:1224 / `main_dizzy_dandy` Bank0C:1243)

The spinning-flower hazard. Init writes `$76,x = $0001` (anim rate)
and `$78,x = $0100` (the SuperFX R6 multiplier seed for the spin
rotation), runs CODE_03AE60, then jumps into mid-Main at
`CODE_0C891C` (so the first frame already produces a rendered
stamp). Main is short: calls helpers `CODE_03AA52` and `CODE_03AF23`,
runs `CODE_0C8A80` (anim helper), and dispatches on `$18,x` (NOT
`$76,x`) through **the 5-entry** `DATA_dizzy_dandy_state_ptr` at
Bank0C:1283 (sleep / wake / chase / dizzy / fall). The dispatch then
falls into the rendering tail at `CODE_0C891C` which writes the
$7400 facing to `$7A36`, sets up SuperFX registers
R5 (anim frame from `$16`), R12/R13 (FXDATA address from
DATA_0C88F7 + DATA_0C8901 paired tables, indexed by `$18`), R6
(multiplier from `$78`), and invokes FXCODE_088205 to plot the spin.
**LABEL-LIKELY-WRONG**: the NormalSpriteIDs.asm comment on $199 says
"4-state spin dispatch", but the actual table at DATA_0C8965 has
**5 entries** (sleep/wake/chase/dizzy/fall). The 4-state count is
inaccurate.

### 23.23 $1AC SmallFrog (`init_frog` Bank0F:2446 / `main_frog` Bank0F:2462)

A small ground-hopping frog. Init at Bank0F:2446 reads `$10` (master
clock low byte), ANDs with $0006 (selecting one of four palette
subpatterns from `DATA_0F9174 = $0000,$0002,$0004,$0008`), and
OR-merges the bits into `$7042,x` (the OAM-attribute-palette byte).
Main runs `CODE_03AF23` then dispatches on `$16,x` through
**the 4-entry** `DATA_0F9197` (idle / leap-prep / leap-airborne /
land). The idle handler at Bank0F:2479 implements the **player-
proximity trigger**: checks `|$7C16,x| < $0030 AND |$7C18,x| <
$0030` (player within a $30x$30 box), if so writes
`$6FA2,x |= $0480` (a render-attribute bit) and zeros `$7A96`
(advance timer); else falls into a wait-loop on `$7A96`. When
ready, transitions to state $04 (jump-prep), seeds `YSpeed = $FF00`
upward, and uses `$10 bit 2` XOR'd with $7400 to randomly flip
facing direction. The leap-airborne state at Bank0F:2542 lands when
`$7860 & $0001` (touched floor) fires, resets to idle with a random
`$7A96 = $0020..$003F` cooldown.

### 23.24 Glitched / unused stubs

- `$04D` UnusedSpriteIndex -- Init (Bank02:1792, `init_unused_4D`) and
  Main (Bank02:1799, `main_unused_4D`) are both bare RTL. Slot is
  reserved between $04E LockedDoor and $04F MiddleRing.
- `$05D` GlitchedSprite -- both Init and Main resolve to Bank05:$FFC4
  (`junk_sprite_pointer`), which is `%FREE_BYTES($05FFC4, 60, $FF)`
  on V1.0 and `%InsertGarbageData` on V1.1. Executing either jumps
  into freespace padding bytes; reserved only because the templated
  SpriteID->Init/Main macros require coverage for every ID.
- `$086` GlitchedSprite -- shares the exact same $05FFC4 placeholder
  handler as $05D (the labels co-locate at the freespace tail of
  Bank05). No working behaviour.

---

## 24. Open questions / unclarities

- **Door open-anim quadrant 4 cleanup.** The door's
  CODE_02A4B5 "post-open" branch reads Yoshi's tile coords from
  `EXRAM_YI_Player_XPosHi & $000F`, low-shifted 2 bits left and
  OR'd into the Y bits -- this is a packed "tile coord index"
  written to `$038E`. The exact layout of that 16-bit byte (whether
  it's used as a level-pointer offset or as a destination tile
  reference) needs cross-checking against `docs/leveldataengine.md`
  §X on per-screen exit pointers.
- **WatermelonFlame ($018) corner cycling order.** The flame walks
  corners $00 -> $04 of `DATA_04832D` in sequence (selected by
  `$7402,x` mod 4). It despawns at $7402 == 4. But there's no
  preserved-frame anim within each corner -- the flame snaps from
  corner to corner. Is the player perceiving a continuous fire
  effect because the four corners are visually clustered, or
  because the engine alpha-blends successive corners? Needs
  cross-check against the renderer in `FXCODE_08867E`.
- **Crazee Dayzee state $02 invocation rate.** State $00 enters
  state $02 only on the `$10 & $003F == 0` boundary (every 64
  master-clock ticks). This is a curiously slow rate -- ~1.05
  seconds at 60 Hz. Is the period also gated by per-slot $7AF6,x
  (lockout timer)? Reading the asm at Bank0F:550 suggests yes:
  $7AF6 must also be zero. So actually the pivot trigger is the
  conjunction of "global clock divisible by 64" AND "lockout
  expired". The result is that the Dayzee pivots ~1-2 times per
  visit per screen, which matches observed gameplay.
- **$181 / $019 Bubble vs $005 / $006 freeze-bubble.** Both spawn
  child sprites visually similar to a bubble. Are they
  graphically the same tile-set, or different tilemaps? Inspection
  of Bank04:725-770 vs Bank0F:691-718 would clarify whether the
  two spawners share OAM data or render-helper code.
- **Pink vs Green Toady code divergence is genuinely small.** Both
  $058 and $05C share the same `init_toadie`, same `main_toadies`,
  same 6-state table, same all 6 state handlers. The only divergences
  are: (1) the $74A2 hit-palette branch at Bank0E:11718 (Green keeps
  $74A2 = previous; Pink sets $74A2 = 2 on hit), and (2) the re-init
  state byte (Green starts at state $02 pursue; Pink at state $05
  drop-disperse if non-first-init). Is the speed/strength
  distinction widely-perceived as a major difference actually a
  rendering / palette illusion combined with the Pink variant
  appearing later in the game when the player has more health?
  Worth a runtime A/B comparison.
- **$091 ambush-trigger conjunction.** The 4-Red-Toady ambush
  spawns when **all** of: (a) `$0E2D` == 0 (no ambush already
  active), (b) `$61B2` (Yoshi-alive flag) is positive, (c)
  `$0B59` and `$0B57` (no items currently in use) are both zero,
  (d) `!RAM_YI_Level_StarTimerLo < !Define_YI_Level_StarTimerThatSpawnsToadiesThreshold`
  ($0A). And then **also** (e) `$61CC` (some interlock counter)
  is non-zero. Item (e) is the unclear gate -- it's
  decremented/incremented elsewhere by the boss-fight logic and
  by the gamemode that follows ambush. Need to trace which
  routine sets `$61CC` to verify the trigger is exactly "Yoshi
  is mountless AND star-timer below $0A AND not currently in a
  protected gamemode".
- **$1A5 RunAwayMonkey -> $1A6 runtime-morph behaviour.** When
  RunAwayMonkey ($1A5) encounters a free Watermelon ($007) it
  morphs into MonkeyWithWatermelon ($1A6) by writing `$701900,x
  = $0004` and linking the watermelon via `$701978,y`. This is
  the only **runtime variant-morph** in the entire family. Worth
  verifying with a save-state test: does the runaway-morphed
  monkey actually start spitting seeds, or does it just look the
  same as a vanilla $1A6? (The dispatch table works on $701900,
  so it should run the spit-seed handler -- but the per-state
  byte `$76,x` and Init-set bits like `$7A38 = $0010` may not be
  configured exactly as $1A6 expects.)
- **Little Mouser nest tilemap variants.** The $033
  LittleMouserExitingNest splits on
  `LevelHeaderBG1TilesetLo == 3` (castle theme). The non-castle
  path starts in state $04 (leave); the castle path starts in
  state $00 (full 8-substate exit-sequence). What about other
  tilesets (jungle, snow, cave)? They use the non-castle path. So
  outside the W5 castle, the Mouser's elaborate exit choreography
  effectively never runs -- the Mouser pops out and immediately
  enters the leave state. Worth a content-coverage check: does
  any non-W5-castle level actually use $033, or is it exclusively
  a W5-castle sprite? Likely the latter (the elaborate animation
  is the visual selling point).
