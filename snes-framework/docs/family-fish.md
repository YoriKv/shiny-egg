# YI Fish / aquatic family reference

Standalone reference for the Yoshi's Island aquatic-enemy family --
the underwater swimmers, surface-dwelling jumpers, jellyfish drifters,
crabs, sluggies (the underwater slime variants, not the boss), and a
couple of "the water itself shoots something at you" hazards. The
family spans seven banks (Bank04, Bank05, Bank07, Bank0C, Bank0D) and
seventeen in-scope sprite IDs. Unlike the Bandit or Boo families it
has no single shared Init body or canonical state machine -- each
sprite has its own dispatcher tuned to the specific water/surface
geometry it sits on. What unites the family is **habitat** (water,
shore, surface line) and a couple of consistent infrastructure
patterns: water-surface anchor stored in `$7A36`/`$7A38`, splash
ambient spawn (`AmbSpr1BA` / `AmbSpr1C4` / `AmbSpr1CE`), and
periodic-trig-table-driven motion (the SuperFX SIN/COS LUTs
`DATA_sine_lut_8bit_radians` / `DATA_cosine_lut_8bit_radians`).

This doc complements:

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_main`, etc.) every entry here layers its own sub-state
  machine on top of. Most fish use `head_bop_common` for their
  `_StompRt` (= can't be stomped) since they're either too small to
  bop or live underwater.
- `docs/bossengine.md` -- carries the boss-tier aquatic enemies
  that are out of scope here: `$016` Bigger Boo (not aquatic but
  shares Bank04 neighbourhood), `$0D7` Sluggy the Unshaven (the
  World-2-4 castle slime boss whose name collides with our `$145`
  / `$146` Pink/Blue Sluggy entries below). The Naval Piranha doc
  section also lives there.
- `docs/family-clouds.md` -- carries Lakitu and the water-side
  surface enemies that spawn ambient projectiles via the same
  `CODE_spawn_ambient_sprite` path used by Spray Fish and Clawdaddy.
- `docs/family-boos.md` -- a couple of underwater boos overlap
  habitat with the fish family but use the Boo-family no-stomp
  dispatcher rather than the per-fish sub-state machines below.

Source of truth: framework asm in `yi/Banks/Bank04.asm` ($015
SubmarineTorpedo, $02C Lunge Fish), `Bank05.asm` ($070 Clawdaddy,
$141/$142 Flopsy Fish jumps), `Bank07.asm` ($13F/$140 Swimming Flopsy
Fish, $143 Spray Fish, $145/$146 Sluggy underwater variants),
`Bank0C.asm` ($0DF Piscatory Pete, $0E0 Preying Mantas, $0E1 Loch
Nestor, $104 Jean De Fillet), `Bank0D.asm` ($06D/$06E Hootie, $154
Shark Chomp). Cross-checked against
`yoshisisland-disassembly/disassembly/bank0{4,5,7,C,D}.asm`
(Raidenthequick descriptive labels already mirrored as aliases in our
asm: `init_torpedo`, `init_lunge_fish`, `main_lunge_fish`,
`init_clawdaddy`, `init_hootie_clockwise`, `init_hootie_anticlockwise`,
`main_hootie`, `init_jean_de_fillet`, `init_flopsy_fish`,
`main_flopsy_fish_swim`, `main_flopsy_fish_jump`,
`init_flopsy_fish_jumps`, `main_flopsy_fish_jumps`, `init_spray_fish`,
`main_spray_fish`, `init_sluggy_blue`, `init_sluggy_pink`,
`main_sluggy`, `init_piscatory_pete`, `main_piscatory_pete`,
`init_preying_mantas`, `main_preying_mantas`, `init_loch_nestor`,
`main_loch_nestor`, `CODE_init_shark_chomp`, `main_shark_chomp`).
Parallel sources `ys_enmy*.asm`, `ys_fish*.asm`, `ys_uwl*.asm`
consulted at the file level only.

---

## 1. Family at a glance

Seventeen in-scope sprite IDs, plus two bosses cross-referenced from
`docs/bossengine.md`.

| Sprite ID | Constant name | Bank | Init handler | Main handler | StompRt | Role |
|-----------|---------------|------|--------------|--------------|---------|------|
| `$015` | `SubmarineTorpedo` | 04 | `$04:8140` `init_torpedo` | `$04:816B` `main_torpedo` | shared stub | Submarine-like horizontal projectile; queries SuperFX `FXCODE_098D5E` for nearest Yoshi-relative vector, picks one of 8 cardinal velocities from `DATA_048153`. Detonates on `AmbSpr1C4` puff + slot-free. |
| `$02C` | `LungeFish` | 04 | `$04:96CC` `init_lunge_fish` | `$04:96FA` `main_lunge_fish` | shared stub | Dock-side jumping eater. 10-state `DATA_lunge_fish_state_ptr`: submerged-wait / rise / aim+lunge / airborne-grab / drag-Yoshi-down / pin / **player_death_spike** / splash-settle / sink / cooldown. Grabs Yoshi mid-air, drags him down, then triggers spike-death player state. |
| `$06D` | `ClockwiseHootieTheBlueFish` | 0D | `$0D:B2EF` `init_hootie_clockwise` | `$0D:B316` `main_hootie` | shared stub | Travels CW around a fixed home centre at radius `$7A36 = $80`. Angle `$7A38` advances each frame; SuperFX `FXCODE_0B8595` plots the new tile position. Egg-stomp routes to state $76=$06 (sink). |
| `$06E` | `CounterclockwiseHootieTheBlueFish` | 0D | `$0D:B2E9` `init_hootie_anticlockwise` | shared `main_hootie` | shared stub | Identical Init shape; presets `$79,x = $0A` (CCW-direction flag) instead of starting angle. Shares everything else with $06D. |
| `$070` | `Clawdaddy` | 05 | `$05:8627` `init_clawdaddy` | `$05:8648` `main_clawdaddy` | shared stub | Side-walking crab. 5-state walk -> raise-claw -> swipe-arc (spawns bubble projectile) -> scissor open/shut -> tremble-recover. Claw OAM overlay subsumes the regular sprite tile during swing frames. |
| `$0DF` | `PiscatoryPete` | 0C | `$0C:CE4D` `init_piscatory_pete` | `$0C:CE83` `main_piscatory_pete` | shared stub | Jumping fish. Init reads `$70E2 bit-4` to pick left/right variant. Main is a two-level dispatcher: per-variant 2-entry state ptr (underwater / arc) where the arc handler queries SuperFX `FXCODE_09907C` for player-relative jump trajectory. |
| `$0E0` | `PreyingMantas` | 0C | `$0C:D064` `init_preying_mantas` | `$0C:D093` `main_preying_mantas` | shared stub | Jellyfish (yes, named "Mantas" but it's a jellyfish in the manual). Init parks Y-anchor in `$18,x` and a 3-step counter `$76,x` from `$70E2 bit-4` parity. 2-state main (cruise / surge): cruise alternates rise/fall via 4-step `$7402` cycle. |
| `$0E1` | `LochNestor` | 0C | `$0C:D122` `init_loch_nestor` | `$0C:D154` `main_loch_nestor` | shared stub | Pufferfish. **Two parallel sub-state machines**: 3-entry underwater (sine-circle drift / approach / dive) at `$19,x`, and 6-entry "emerge" / inflate-cycle at `$18,x`. Inflate ramps `$16,x` from $00A0 through $0133, then pops via `CODE_04849E` + sound `$3B` (Pop). |
| `$104` | `JeanDeFillet` | 0C | `$0C:B636` `init_jean_de_fillet` | `$0C:B6AC` `main_jean_de_fillet` | shared stub | "Bone fish" (skeletal). Init probes water-vs-ground via `FXCODE_0ACE2F` and lifts `$7182` by up to $08 to land on the water line. 4-state main (jump-out / arc / dive / return); `CODE_0CB7EC` reads Map16 to dig dirt-blocks on impact + spawns splash (`AmbSpr1C3` / `AmbSpr1C7` / `AmbSpr1BA`). |
| `$13F` | `SwimmingFlopsyFish` | 07 | `$07:B28E` `init_flopsy_fish` | `$07:B2F3` `main_flopsy_fish_swim` | shared stub | Pure horizontal-cruise variant. 7-state shared engine `DATA_flopsy_fish_state_ptr` driving swim cycle. In Lake Shore Paradise (`!Define_YI_LevelID_LakeShoreParadise`) the Init nudges spawn Y down by 4 px so it sits at the right BG depth for that level. |
| `$140` | `SwimmingAndJumpingFlopsyFish` | 07 | shared `init_flopsy_fish` | `$07:B310` `main_flopsy_fish_jump` | shared stub | Adds a periodic surface-jump trigger via `CODE_07B33E`: every $40 frames, on RNG bit-mask hit, zeros velocities and jumps state to $04 (jump arc). Same swim state table as $13F. |
| `$141` | `SwimmingAndArcJumpingFlopsyFish` | 05 | `$05:F6DE` `init_flopsy_fish_jumps` | `$05:F74E` `main_flopsy_fish_jumps` | shared stub | Different bank, different Init/Main pair. 4-state machine (swim-or-wait / arc-jump / airborne / GSU-stub). X-speed from `DATA_05F84C` selected by spawn-side; arcs out toward Yoshi when on-screen. |
| `$142` | `3JumpFlopsyFish` | 05 | shared `init_flopsy_fish_jumps` | shared `main_flopsy_fish_jumps` | shared stub | Identical Main as $141; differs only by `$16,x = 3` triple-jump counter that the arc-handler decrements. Leaves and re-enters water for each jump. |
| `$143` | `SprayFish` | 07 | `$07:BE90` `init_spray_fish` | `$07:BEFC` `main_spray_fish` | shared stub | Stationary water-spout enemy. 6-state (idle / wind-up / spray / pause / re-aim / despawn). Spray fires a column of ambient water (`AmbSpr1BA`) with thunder-cue sounds; aims at Yoshi using SuperFX trig table `DATA_07BEB4` (signed-integer arc-tangent LUT). |
| `$145` | `BlueSluggy` | 07 | `$07:B6A3` `init_sluggy_blue` | `$07:B6DC` `main_sluggy` | shared stub | Underwater slime (NOT `$0D7` Sluggy the Unshaven, which is a boss). 4-state: idle (face Yoshi) / spit / chase (lunge onto land) / despawn. Falls through to `init_sluggy_pink`. |
| `$146` | `PinkSluggy` | 07 | `$07:B6AC` `init_sluggy_pink` | shared `main_sluggy` | shared stub | Identical body to $145; the only difference is the entry-point Init skips the X-velocity preload from `DATA_07B69B`. Palette divergence is at the sprite-table level. |
| `$154` | `SharkChomp` | 0D | `$0D:A097` `CODE_init_shark_chomp` | `$0D:A0FE` `main_shark_chomp` | shared stub | Giant lunging shark. Init defers actual setup until Yoshi-X is close (CMP against `RAM_YI_Global_Layer1XPosLo` -- "off-camera-to-the-left"); then reconfigures `MainScreenLayers = $15` and seeds Layer-3 X/Y to frame the encounter. Main runs 7-entry `DATA_0DA0F0` (idle wait / surface / lurk / chomp-lunge / mid-chomp / sink / despawn). |

Two boss-tier members cross-referenced from `docs/bossengine.md`:

| Sprite ID | Constant name | Documented in |
|-----------|---------------|----------------|
| `$0A5` | `NepEnut` (= Gargantua Blargg in W6 reskin) | `docs/bossengine.md` -- underwater boss; shares code, different palette+tileset between Worlds. |
| `$194` | `Blargg` | `docs/bossengine.md` -- the lava hazard; not strictly aquatic but uses the same submerged-emerge state pattern as Lunge Fish and Loch Nestor. |

### 1.1 Banks-at-a-glance

| Bank | Fish sprites in scope |
|------|-----------------------|
| 04   | `$015` Torpedo, `$02C` Lunge Fish |
| 05   | `$070` Clawdaddy, `$141`/`$142` Flopsy Fish jumps |
| 07   | `$13F`/`$140` Swim Flopsy, `$143` Spray Fish, `$145`/`$146` Sluggy |
| 0C   | `$0DF` Piscatory Pete, `$0E0` Preying Mantas, `$0E1` Loch Nestor, `$104` Jean De Fillet |
| 0D   | `$06D`/`$06E` Hootie, `$154` Shark Chomp |

The distribution is broader than the Boo family (which clusters in
Bank06) because water-themed sprites appear across most of the game
-- jungle, swamp, lake, sewer, and castle levels each lean on
different fish variants.

---

## 2. Shared infrastructure across the family

### 2.1 Water-surface sentinel pattern (`$7A36` / `$7A38`)

Six of the seventeen sprites store a "home depth" in one of the
`$7A36,x` / `$7A38,x` slot fields and use it to clamp Y back to the
surface line after a jump:

- `$02C` LungeFish: Init stows `$7182,x -> $7A36,x` then *raises* the
  sprite by $20 so the spawn position is the "submerged" depth and
  `$7A36` is the "surface" target. `CODE_049943` does the splash
  return: if Y >= `$7A36`, snap Y to `$7A36` and spawn `AmbSpr1CE`
  splash + sound `$5F` (Splash1).
- `$104` JeanDeFillet: Init runs `FXCODE_0ACE2F` to *find* the water
  line dynamically (the result is the `R6_Multiplier` SFX register
  high-byte; if it returns `$7E00` the probe hit "air" rather than
  "water" and the Init loops to retry 4 px deeper). Final `$7A38,x`
  is the validated water-line Y.
- `$0E1` LochNestor: Init stows `$70E2 -> $7A36` and `$7182 ->
  $7A38` as the *home circle centre*. State $00 (drift) draws a sine
  circle around them.
- `$0DF` PiscatoryPete: doesn't use $7A36/$7A38 for surface; tracks
  the "above water" condition via the `$7860,x & $000F` floor-flag
  byte instead (state $00 ducks back when any flag bit is set).
- `$143` SprayFish: Init stows BOTH a left bound (`$7182 - $1C ->
  $7A36`) and a right bound (`$7182 + $08 -> $7A38`). Range of motion
  for the rising spout column.
- `$145`/`$146` Sluggies: surface-detection via `$7860,x & $0001`
  (the floor flag) rather than a stored Y -- once they cross water
  the floor flag transitions to "land" and they hop / chase.

### 2.2 The splash-spawn idiom

Every "fish leaves water" or "fish re-enters water" transition spawns
a small splash via `CODE_spawn_ambient_sprite`. The 4-line idiom is
verbatim across the family:

```
LDA #!Define_YI_AmbSpr1BA      ; or 1CE / 1C3 / 1C7 / 1C4
JSL CODE_spawn_ambient_sprite
LDA $70E2,x : STA $70A2,y      ; copy X
LDA $7182,x : STA $7142,y      ; copy Y (or modified Y)
LDA #$0001 (or $0003 / $001A) : STA $7E4C,y or $7782,y  ; lifetime
LDA #!Define_YI_SoundID5F_Splash1   ; or $60/$61 (Splash2/3)
JSL CODE_push_sound_queue
```

The five ambient-sprite variants used for splash-effects:

| Variant | Used by |
|---------|---------|
| `AmbSpr1BA` | Water splash for water-transition: Spray Fish (every spout), Shark Chomp (chomp surface), Jean De Fillet (return-to-water) |
| `AmbSpr1CE` | 2-stage minimalist splash: Lunge Fish `CODE_049943` splash-return |
| `AmbSpr1C3` | 2-frame stutter blink: Jean De Fillet dirt-block impact |
| `AmbSpr1C7` | "Effect landed" indicator: Jean De Fillet variant 2 |
| `AmbSpr1C4` | 4-stage sparkle: Submarine Torpedo detonation |

Sound IDs `$5F` Splash1 / `$60` Splash2 / `$61` Splash3 form the
hierarchy: 5F is the soft "in/out" splash, 60 is the harder
"crash through surface", 61 is the "spurting / sustained" variant
that SprayFish loops on its spray frames.

### 2.3 SuperFX trig-table usage

Four family members lean on SuperFX trig-table queries for motion:

| Sprite | FXCODE | What it computes |
|--------|--------|-------------------|
| `$015` Torpedo | `FXCODE_098D5E` | Nearest-Yoshi vector probe -- returns X/Y deltas in `R1`/`R2`; quadrant lookup picks one of 8 cardinal velocities from `DATA_048153`. |
| `$06D`/`$06E` Hootie | `FXCODE_0B8595` | Plot-on-circle: given angle `$7A38` and radius `$7A36`, returns absolute X/Y. |
| `$0DF` Pete (state arc) | `FXCODE_09907C` | Yoshi-relative-vector with magnitude scaled by `$R6_Multiplier = $0200`. Result divided by 64 to get jump X/Y speeds. |
| `$0E1` LochNestor (approach) | `FXCODE_09907C` | Same as Pete, but with `R6 = $0080` (slower approach speed). |
| `$0E1` LochNestor (drift) | `DATA_sine_lut_8bit_radians` / `_cosine_lut_8bit_radians` (no SFX call -- read directly from CPU since LUTs live in ROM at `$70xxxx`) | Sine-circle drift -- angle $701900 advances each frame mod $1FE. |
| `$143` Spray Fish | inline `DATA_07BEB4` table (no SFX call; CPU-side LUT) | 36-entry signed-integer arc-tangent LUT for aiming the spout at Yoshi. |

LochNestor's drift handler (`CODE_0CD1ED`, Bank0C.asm:10711) is the
cleanest example of the "rotate around a centre" idiom in the
codebase. It advances `EXRAM 701900,x` by 1 mod 512 to step the
angle, indexes `DATA_sine_lut_8bit_radians` for the X-offset and
`DATA_cosine_lut_8bit_radians` for the facing-direction sign bit,
applies a triple `CMP #$8000 : ROR` (the asar 16-bit arithmetic-
shift-right idiom -- signed `>> 3`) to the sine result to scale it
down by 8, and stores `home_X + scaled_sin` to `$70E2,y`. Net
effect: sine values in $7000-$7FFF range get divided by 8, giving
a sub-pixel radius of ~16 px.

### 2.4 Player-death and grab handoffs

Three fish can kill Yoshi directly (bypassing the standard egg-loss
contact):

- `$02C` LungeFish state $06 (`CODE_lunge_fish_state_06_life_loss_handoff`)
  calls `CODE_player_death_spike` (the spike-death player state).
- `$0E1` LochNestor on inflate-complete pops the slot but doesn't
  kill Yoshi -- the danger is the inflated body being a moving wall.
- `$154` SharkChomp's chomp-lunge in state $03 sets `$60D2 = $8001`
  (player state "swallowed by boss") which triggers the boss-eat
  cinematic if it connects.

LungeFish is the only one in the family with an explicit
`CODE_player_death_spike` call -- the rest leave death-handling to
the engine's contact mechanic in `CODE_03A5B7`.

### 2.5 The `head_bop_common` no-stomp pattern

All seventeen in-scope fish use the shared no-stomp body
`CODE_head_bop_common` (Bank03.asm:4304) as their `_StompRt`. In
practice this means:

- Submarine Torpedo, Sluggy variants, Hootie, Jean De Fillet, Sharks,
  Spray Fish, the Mantas, Loch Nestor, Pete: cannot be stomped (Yoshi
  bounces off). The standard kill is egg-hit.
- Lunge Fish: cannot be stomped (it's underwater + airborne, hard to
  reach safely).
- Flopsy Fish variants ($13F-$142): the Status byte transition
  `$000C` (= "stomped") IS handled at the top of Main
  (`main_flopsy_fish_swim`) -- they set `$7402,x = $0003` (death
  animation frame) and let the state machine carry them away. So
  these CAN be stomped despite the shared StompRt. The mechanic is
  "stomp = state-byte side-effect" rather than "StompRt body".
- Clawdaddy: same pattern as Flopsy Fish -- stomp routes via
  `CODE_058655` only when the swipe-active flag `$7D96,x` is set;
  otherwise `CODE_058658` (the regular update) treats it as
  unstompable.

### 2.6 Off-screen guard pattern

Every fish has either an explicit off-screen despawn or relies on
the engine's standard slot-cleanup. The most aggressive guard is in
Submarine Torpedo at `$04:81C0` which calls `CODE_03A31E`
(free-slot) the moment Yoshi is sufficiently far away OR the
ambient-puff has been spawned. This is a "fire and forget"
projectile contract.

The standard pattern in long-lived sprites (Hootie, Loch Nestor,
Spray Fish) is the engine-provided `CODE_03AA2E` (off-screen-check
helper) + `CODE_03A2F8` (free if off-screen result is positive). No
fish in the family is explicitly "respawn-on-scrollback" -- once
killed, they stay dead until the level reloads.

---

## 3. Per-sprite breakdown

### 3.1 $015 SubmarineTorpedo (Bank04)

A horizontal projectile that hunts Yoshi underwater. Init at
`$04:8140` is a thin wrapper around `CODE_03AD24` (standard
sprite-spawn prologue); on success it stores sub-pixel Y init `$7F`
into `$7863,x` and returns.

Main `$04:816B` runs the standard motion + collision passes, then
walks two arming checks (`$7D36,x` "held-by" link, `$7860` floor
flag), then -- if neither fires -- queries SuperFX `FXCODE_098D5E`
for the player-relative vector and chooses one of 8 cardinal
velocities from `DATA_048153 = $0000, $8040, $8000, $00C0, $8080,
$0040, $0080, $80C0`. Each entry is a packed `(X-speed-bit |
Y-speed-bit)` form -- the high bit selects sign, low bits select
magnitude. Quadrant is computed by sign-extending both deltas, then
comparing magnitudes to pick the closer-cardinal direction. Final
velocity is written via `DATA_048163` (`$0200, $FE00`) and
`DATA_048167` (`$0800, $F800`).

On detonation, the routine spawns `AmbSpr1C4` (the 4-stage sparkle)
and frees the slot. The torpedo is one-shot.

### 3.2 $02C LungeFish (Bank04)

Dock-side jumping eater. The signature mechanic: leaps out of the
water, grabs Yoshi mid-air, drags him down, pins him, then triggers
the spike-death player state. Init at `$04:96CC` stows current Y in
`$7A36,x` (as the "surface" target), raises the sprite 32 px so it
spawns submerged, then primes `EXRAM 701900,x = $0010` (lunge X-
offset target) and `701902,x = $70E2` (home X).

The 10-state machine `DATA_lunge_fish_state_ptr` (`$04:96E6`):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_lunge_fish_state_00_submerged_wait` | Wait for Yoshi to be within ~$100 px X-range; on hit, set Y-vel = `$0400` (rise) and `INC $76,x`. |
| `$02` | `CODE_lunge_fish_state_01_rise_to_surface` | Watch Y vs `$7A36`; on surface-cross (handled by `CODE_049943`), zero velocities, spawn `AmbSpr1CE` splash + sound `$5F`, arm cooldown, `INC $76,x`. |
| `$04` | `CODE_lunge_fish_state_02_aim_and_lunge` | After cooldown, pick aim Y from `DATA_0497BE`/`DATA_0497C2`, set X-vel + Y-vel for the lunge arc, play sound `$83` (LungeFish), set `$74A2,x = $0002` (hitbox armed). |
| `$06` | `CODE_lunge_fish_state_03_airborne_grab` | Mid-air -- check if Yoshi is in the grab window (`$7C16,x ± $20`, `$7C18,x ± $30`); on hit, set player state `$1A` (DisableInput), animation frame `$60BE = $006B`, `CantUseItemsFlag = $006B`, advance to drag-down. |
| `$08` | `CODE_lunge_fish_state_04_drag_yoshi_down` | Move Yoshi's X/Y in lockstep with the fish; on surface-cross, arm pin-timer and advance. |
| `$0A` | `CODE_lunge_fish_state_05_pin_yoshi` | Pin Yoshi at the fish's position for $20 frames. |
| `$0C` | `CODE_lunge_fish_state_06_life_loss_handoff` | When timer expires, `JSL CODE_player_death_spike` (spike-death player state). Yoshi dies and the level restarts. |
| `$0E` | `CODE_lunge_fish_state_07_splash_settle` | Splash settle after a failed grab. |
| `$10` | `CODE_lunge_fish_state_08_sink_below` | Sink back below surface. |
| `$12` | `CODE_lunge_fish_state_09_rise_cooldown` | Cooldown before another lunge attempt. |

The grab-detection geometry is unusually tight: state $03 checks
`$7C16,x` (X-distance to Yoshi) and `$7C18,x` (Y-distance) against
two windows -- the inner one (`±$10` X, `±$18` Y) is "snap-grab" and
the outer one (`±$12` X, `±$18` Y) is "deflect Yoshi" (the fish nudges
Yoshi's velocity from `DATA_04988E`/`DATA_049892` if it doesn't quite
grab). So you can be sideswiped by an unsuccessful lunge.

### 3.3 $06D / $06E Hootie the Blue Fish (Bank0D)

A blue fish that travels in a perfect circle around a fixed centre.
$06D goes clockwise, $06E counter-clockwise. The two Inits share a
fall-through structure:

- `init_hootie_anticlockwise` (`$0D:B2E9`): sets `$79,x = $0A`
  (CCW-direction sentinel) and jumps into the shared body.
- `init_hootie_clockwise` (`$0D:B2EF`): sets `$7A38,x = $0100`
  (angle = pi, top of circle) and falls through.
- Shared body (`$0D:B2F5`): `JSL CODE_03AE60` common Init prologue,
  arm `$18,x = 1` (active), set `$7A36,x = $0080` (radius), call
  `CODE_0DB43E` for first-frame replot.

The asymmetry: $06D presets angle = $0100; $06E presets the
direction flag = $0A. The shared `CODE_0DB43E` (replot) honours
`$79,x` -- if nonzero, angle advances by `$0A` per frame in the
negative direction; if zero, by some positive default. Net effect:
$06D rotates CW from the top of circle, $06E rotates CCW from the
same starting frame.

The 7-state main `DATA_0DB308` (`$0D:B308`):

| `$76,x` | Role |
|---------|------|
| `$00` | Patrol / circle. Advance angle, replot via `CODE_0DB3B9` -> `FXCODE_0B8595`. |
| `$02` | Lurk under platform (suspended-ride logic; entries 0/1 are the two patrol speeds). |
| `$04` | Lunge-at-Yoshi -- accelerates radius outward briefly. |
| `$06` | Stomp / sink. Zero velocities, freeze pose. |
| `$08` | Re-link to a held-by sprite. |
| `$0A` | (Bookkeeping entry for held-by check.) |
| `$0C` | Despawn / final settle. |

`CODE_0DB3B9` is the SuperFX replot: it loads
`!REGISTER_SuperFX_R1_PLOTXCoordinateLo` with `($7A38 + $80) & $1FE`
(angle offset by pi to make the spawn point line up) and
`!REGISTER_SuperFX_R6_MultiplierLo` with `$FFF8` (CCW) or `$0008`
(CW) as the per-frame angle increment, then calls `FXCODE_0B8595`
which writes the resulting absolute X/Y into the OAM stage.

### 3.4 $070 Clawdaddy (Bank05)

Side-walking crab found in beach/swamp stages. The most "scriptable"
fish in the family -- five-state walk -> raise-claw -> swipe-arc ->
scissor open/shut -> tremble -> repeat. Init at `$05:8627` arms the
turn-timer `$16,x = $FFFF` and direction-counter `701902 = $0003`.

5-state main dispatch `DATA_clawdaddy_state_ptr` (`$05:8636`):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_clawdaddy_state_walk` | Walk patrol. X-speed from `DATA_clawdaddy_walk_xspeeds` (4 entries indexed by `RANDM0 & $02 + $7A36 facing`: `+$00B3`, `+$0059`, `-$00B3`, `-$0059`). |
| `$02` | `CODE_clawdaddy_state_raise_claw` | Wind-up phase. Arm `$7AF8,x` swing-counter; switch sprite to "claw raised" pose. |
| `$04` | `CODE_clawdaddy_state_swipe_arc` | Claw swipe. On peak frame, spawn bubble projectile (likely `AmbSpr1BA` water-droplet). |
| `$06` | `CODE_clawdaddy_state_scissor` | Scissor open/shut cycle. Two-frame OAM flicker. |
| `$08` | `CODE_clawdaddy_state_recover` | Tremble / settle. Back to state $00. |

Animation overlay: when `$7AF8,x` (swing-counter) is non-zero, Main
substitutes the claw OAM tile from `DATA_clawdaddy_anim_frames`
(`$0022, $0024, $0026, $0028`) and reverses X-motion so the body
doesn't drift during the swing. This is one of the cleaner "stop
moving while attacking" patterns in the codebase.

`CODE_clawdaddy_claw_collision_check` (`$05:8723`) is a SuperFX-driven
hitbox: when `$7D96,x` is set (claw-swipe active) or status = `$0012`
(damaged), the claw can crush Yoshi independently of the main sprite
hitbox. The crush is per-OAM-tile, computed via `CODE_03AA52` and
written directly into the SuperFX stage.

### 3.5 $104 JeanDeFillet (Bank0C)

Skeletal fish (the name is a pun on "fillet of fish"). Lives on the
water line; pops out, arcs over, dives, returns. The Init has the
most-careful "find the water line" logic in the family: it primes
`$7A36,x` (X-target), `$16,x = $3000` (vertical accel), then either
takes a tileset-3 fast-path (assumes water is exactly at spawn Y - 4)
or runs the `FXCODE_0ACE2F` Map16 probe with retry-loop. When the
probe's `R6_Multiplier` high byte is `$7E` (= "open air" tile), Jean
shifts up 4 px and retries; otherwise stows the validated Y in
`$7A38,x`.

This is the same general-purpose probe FXCODE used by Boos. The
retry-loop makes Jean robust to off-by-one-tile level data.

4-state main `DATA_jean_de_fillet_state_ptr` (`$0C:B6C9`):

| `$18,x` | Role |
|---------|------|
| `$00` | Jump-out: when `$7A96` cooldown expires, set Y-vel = `$FA00` (upward $5C0), X-vel from `DATA_0CB62E` (signed by facing). |
| `$02` | Arc -- in-air; on apex (Y ≥ surface + $10), flip facing and re-stow X-target. Spawn dirt-block-impact ambient sprites via `CODE_0CB7EC`. |
| `$04` | Dive -- Y-vel = `$FF00`, accelerate downward. |
| `$06` | Return -- restore home Y, halt vertical motion, arm cooldown for next jump-out. |

`CODE_0CB7EC` (referenced by state $02) reads `$70001C,x` (a slot's
Map16-lookup byte) and `$700020,x` -- both EXRAM staging windows.
The `AND #$F800 / CMP #$4000` test checks for the "dirt/breakable"
tile type code; on hit, the routine zeros the tile and spawns
`AmbSpr1BA` splash + sound `$60` (Splash2). So Jean can chip
breakable tiles when he arcs through them.

### 3.6 $0DF PiscatoryPete (Bank0C)

Jumping fish with a 2-variant (left/right) split. Init at `$0C:CE4D`
reads `$70E2 bit-4` (pixel-X parity) to pick the variant index in
`$16,x`, loads facing-relative X-acceleration from `DATA_0CCE41 =
$FF00, $0100`, OAM flip from `DATA_0CCE45 = $000E, $000C`, and OAM
priority from `DATA_0CCE49 = $0061, $04A1`.

Main dispatches through a *two-level* table: `$16,x` (variant) ->
`$18,x` (sub-state):

```
DATA_piscatory_pete_state_ptr:                   ; 2 entries (left / right)
    dw CODE_0CCE9C        ; left variant
    dw CODE_0CCEA8        ; right variant
DATA_piscatory_pete_left_substate_ptr:           ; 2 entries
    dw CODE_0CCEB4        ; sub-state 0: underwater (X-target tracking)
    dw CODE_0CCFB2        ; sub-state 1: arc
DATA_piscatory_pete_right_substate_ptr:          ; 2 entries
    dw CODE_0CCEB4        ; same underwater handler
    dw CODE_0CCF13        ; right arc handler (calls FXCODE_09907C)
```

State $00 (underwater) accelerates toward an X-target via
`$75E0,x` -- the right variant overshoots and slides back. State $1
(arc) is the player-relative jump trajectory, where the right
variant queries `FXCODE_09907C` for a vector toward
(`$611C, $611E`) = (Yoshi camera X, Yoshi camera Y). The result is
SH'd down by 6 bits to produce a moderate arc Y-velocity.

The two-level structure exists because the right-facing variant's
arc is "homing" while the left-facing one's is "fixed parabola" --
they share state $00 but diverge on the jump.

### 3.7 $0E0 PreyingMantas (Bank0C, jellyfish)

A jellyfish that drifts vertically and periodically surges upward.
The name says "Mantas" (plural manta ray) but the in-game sprite is a
single jellyfish; the misnomer is consistent across reference
materials.

Init at `$0C:D064` arms `$75E2,x = $FF00` (upward Y-accel),
`$7542,x = $0010` (Y-vel cap), `$18,x = $7182` (Y-anchor stash),
`$7402,x = $0003` (anim frame), and picks `$76,x` from
`DATA_0CD060 = $02, $02, $05, $05` keyed by pixel-X bit-4 parity.

2-state main:

| `$16,x` | Role |
|---------|------|
| `$00` | Cruise. Alternates rise/fall via a 4-step `$7402` cycle with timings from `DATA_0CD08B = {$08, $04, $04, $08}`. On counter expiry, hit "phase end" branch to surge. |
| `$02` | Surge. Y-accel reset to `$FF00`, decelerate; on reaching anchor `$18,x` (stowed in Init), clear Y-vel and return to cruise. |

The cruise oscillation is the smoothest motion in the family -- it
runs entirely on the engine-side velocity integration (`CODE_03AF23`)
with two-direction acceleration. The "surge" is just a longer
acceleration window before the cycle resets.

### 3.8 $0E1 LochNestor (Bank0C, pufferfish)

A pufferfish with a sine-circle underwater path and a separate
"emerge + inflate + pop" emerge cycle. The unique thing about this
sprite: **two parallel sub-state machines** running on the same
slot, dispatched by different sprite-RAM fields.

Init at `$0C:D122` is straightforward (radius / centre setup,
selects starting drift direction from `$7400`). Main runs the
SuperFX render via `FXCODE_088205`, the standard motion update, the
player-contact check (`CODE_0CD435`), then branches on `$6FA0,x bit
$0020` to select which dispatcher runs: when set, it jumps through
`DATA_loch_nestor_emerge_substate_ptr` (keyed by `$18,x`); when
clear, through `DATA_loch_nestor_underwater_substate_ptr` (keyed by
`$19,x`).

The `$6FA0,x bit $0020` flag is the engine's "sprite-buffer-attribute"
byte; bit $20 serves double-duty as the "emerged" flag for this
sprite.

Underwater substates (`DATA_loch_nestor_underwater_substate_ptr`,
3 entries):

| `$19,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0CD1ED` | Sine-circle drift around `$7A36, $7A38` home. Uses ROM-resident sine/cosine LUTs directly. |
| `$02` | `CODE_0CD228` | Approach Yoshi -- `FXCODE_09907C` for vector, sub-pixel scaled `>> 4`. |
| `$04` | `CODE_0CD287` | Dive into the home tile. When X and Y are both within $1 of home, snap to home, zero velocities, advance to next emerge cycle. |

Emerge substates (`DATA_loch_nestor_emerge_substate_ptr`, 6 entries):

| `$18,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0CD347` | Reset `$16,x` to $A0 (deflated radius), clear bit $0020 (back underwater). Anim frame mask. |
| `$02` | `CODE_0CD36E` | Inflate phase 1 -- `$16,x` ramps to $EC, then advance. |
| `$04` | `CODE_0CD387` | Inflate hold at $CC -- arm `$7A98,x` cooldown. |
| `$06` | `CODE_0CD3AB` | Inflate phase 2 -- ramp to $120. |
| `$08` | `CODE_0CD3B6` | Inflate phase 3 -- hold at $100. |
| `$0A` | `CODE_0CD3BD` | Final inflate -- ramp `$16,x` to $133, then **POP**: `JSL CODE_04849E` + sound `$3B` (Pop) + free slot. |

The radius byte `$16,x` is also used by `CODE_0CD3DC` (the SuperFX
render) as the `R6_Multiplier` -- so the body literally grows
visually as the inflate ramps. From $A0 (160 px scale-mult) to $133
(307 px scale-mult), the body roughly doubles before popping.

### 3.9 $13F / $140 Swimming Flopsy Fish (Bank07)

Pure-cruise underwater fish. Two variants share the Init
(`init_flopsy_fish` at `$07:B28E`) and differ only in Main:

- `$13F` Main: `main_flopsy_fish_swim` -- runs the 7-state shared
  table only.
- `$140` Main: `main_flopsy_fish_jump` -- runs `CODE_07B33E` ("can
  we jump?") first, which on RNG bit-mask hit zeros velocities and
  promotes state to $04 (jump arc), then runs the same table.

Init reads the spawn level ID for a Lake Shore Paradise special-case:
when `!RAM_YI_Level_CurrentLevelFromMapLo ==
!Define_YI_LevelID_LakeShoreParadise`, it nudges spawn Y down by 4
px before the common Init logic. The common Init then stows home X
in `$18,x`, offsets X to side-of-home via `DATA_07B282 = $0020,
$FFE0`, and seeds X-velocity from `DATA_07B286 = $FF00, $0100`.

The 7-state machine `DATA_flopsy_fish_state_ptr` (`$07:B330`):

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_07B35F` | Cruise. Pick anim frame from `DATA_07B2EB`/`_07B2EF`. |
| `$02` | `CODE_07B3FE` | Direction-reverse phase 1 (turn at edge of `$18,x ± $40`). |
| `$04` | `CODE_07B455` | Jump-arc launch. |
| `$06` | `CODE_07B492` | Airborne. |
| `$08` | `CODE_07B53D` | Splash-down. |
| `$0A` | `CODE_07B580` | Re-enter water settle. |
| `$0C` | `CODE_07B5D6` | Anim frame post-jump. |

The Lake Shore Paradise carve-out is a rare per-level fix: the
level's BG depth puts the water line 4 px lower than the standard
"flopsy fish spawn Y" the level data assumes, so the Init nudges
spawn Y down to compensate. This is one of two per-level
behavioural carve-outs in the fish family (the other is Shark
Chomp's MainScreenLayers reconfigure).

### 3.10 $141 / $142 Flopsy Fish jumps variants (Bank05)

Different bank, different state machine. These two share their own
Init/Main pair distinct from the Bank07 swim variants:

- `$141` Init = `$142` Init = `init_flopsy_fish_jumps` at `$05:F6DE`.
- `$141` Main = `$142` Main = `main_flopsy_fish_jumps` at `$05:F74E`.
- Variants differ only in Init's `$16,x` repeat-counter handling:
  $141 starts at $03 (single-jump), $142 starts at $03 but the arc
  handler decrements per-jump to give a 3-jump pattern.

The 4-state machine `DATA_flopsy_fish_jumps_state_ptr` (`$05:F746`):

| `$76,x` | Role |
|---------|------|
| `$00` | Swim / wait at home X (`701900`). If Yoshi crosses spawn-side, advance to arc-jump (`CODE_05F872`). |
| `$02` | Arc-jump (`CODE_05F8DD`). |
| `$04` | Airborne / falling (`CODE_05F922`). |
| `$06` | GSU-stub (no-op / cleanup). |

State $00's trigger condition mixes Yoshi-distance and side-of-spawn:
`$70E2,x - $6094 + $40 vs $80` is a "within $40 px of Yoshi camera
position" check. So the fish stays asleep until Yoshi gets close
enough horizontally, then lunges out. X-velocity from `DATA_05F84C =
$FEF8, $0108` (signed: $108 = $0108 forward, $FEF8 = -$0108 backward).

A useful surprise: the variant marker for "is this a Stork-payload
fish?" lives in this Init:

```
LDY EXRAM_..._SpriteID,x
CPY #!Define_YI_NorSpr041_Stork
BEQ CODE_05F737      ; alternate spawn path (Stork dropped this fish)
```

So this Init is reused as a **Stork drop-payload handler**: the
Stork ($041) spawns these via `CODE_spawn_sprite` and the Init
detects its own sprite-ID-equals-Stork case for the "born from
Stork carry" path, which sets up a hover-and-fall arc rather than
a swim cycle. (The Stork-detection path doesn't actually create a
fish sprite -- it creates the BABY MARIO payload sprite, which
reuses this Init template through `CPY = $041`.)

### 3.11 $143 SprayFish (Bank07)

Stationary water-spout enemy that fires a vertical column of water.
Init at `$07:BE90` stows the left X-bound in `$76,x` (= spawn X -
$20), right X-bound in `$78,x` (= spawn X + $20), surface Y in
`$7A38,x` (= spawn Y + $08), and "spout top" Y in `$7A36,x` (=
surface Y - $1C).

The dual-Y stash ($7A38 = surface, $7A36 = spout-top) is unusual --
most fish only stash one. SprayFish uses it to scale the spout
column visually (the column height varies between $1C and 0).

6-state main `DATA_spray_fish_state_ptr` (`$07:BF2D`):

| `$18,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_07BF39` | Idle. Watch for Yoshi within X-distance and $A0 Y. On range hit, spawn first `AmbSpr1BA` splash + sound `$61` (Splash3), arm `$7A96 = $18`, set Y-vel = `$FF00` (upward). |
| `$02` | `CODE_07BFBF` | Wind-up. After timer, anim-advance, arm `$7A98 = $30`, `$7AF6 = $D1`. |
| `$04` | `CODE_07BFF3` | Spray. Every 4 frames check `$14 & $0003` -- play sound `$51` (ThunderLakituAttacking1). Process per-row spray geometry via `CODE_07C192` and per-tile pose `DATA_07BFE0` (a 19-element stutter table). |
| `$06` | `CODE_07C04E` | Pause / hold spout. After `$16,x` ticks, spawn another splash, set Y-vel = `$0100` (downward), reset anim. |
| `$08` | `CODE_07C0B1` | Re-aim. Pick new target X. |
| `$0A` | `CODE_07C0DD` | Despawn. |

The aim mechanism uses the inline `DATA_07BEB4` table -- 36 16-bit
signed values from $FFF0 to $FF95. This is a signed-integer
arc-tangent LUT: given an X-distance to Yoshi, the table indexes a
proportional Y-vector offset. It's queried directly from CPU code
in `CODE_07C285` (the re-aim handler) -- no SuperFX involvement.

### 3.12 $145 / $146 Sluggy variants (Bank07)

Underwater slimes that lurk in water, lunge onto land, then chase
Yoshi for one body-length before dying. **These are NOT the
boss-tier Sluggy the Unshaven ($0D7)** which lives in Bank02 and is
documented in `docs/bossengine.md`. The two slime-things share a
visual style but the underwater variants are walking enemies on a
4-state machine while the Unshaven boss is a 7-segment GSU dyntile
construct with HP and phase progression.

Init at `$07:B6A3`: $145 (`init_sluggy_blue`) preloads X-velocity
from `DATA_07B69B = $FFE0, $0020` (facing-based), then falls through
to $146 (`init_sluggy_pink`) which sets `$7A96,x = $0008` (anim
pace), `$18,x = $0003` (pose index), `$7402,x` from
`DATA_07B74B = $01, $02, $01, $00`, `$7542,x = $0100` (Y-vel cap),
and a range pair in `701900,x` / `701902,x` derived from
`DATA_07B69F = $0060, $0030` keyed by pixel-X bit-4 parity.

The fall-through structure: only behavioural difference is "Blue
moves at spawn, Pink waits for proximity".

4-state main `DATA_sluggy_pink_blue_state_ptr` (`$07:B716`):

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_07B71E` | Idle. Periodically rotate anim via `DATA_07B74B = $01, $02, $01, $00` (4-step cycle). When Yoshi is in range ($701902 vs camera X), arm splash and advance. |
| `$02` | `CODE_07B774` | Spit / wind-up. `DATA_07B76F = $04, $03, $02, $01, $00` -- 5-step anim. On expiry, nudge Y up by 4, set Y-vel = $0400 (down) -- the "splash onto land" arc. |
| `$04` | `CODE_07B7C1` | Chase. On floor-flag bit $0001 hit (= now on land), play sound `$60` (Splash2), set OAM priority bit, run `DATA_07B7B7`/`DATA_07B7BC` chase-pose cycle. On counter expiry, despawn. |
| `$06` | `CODE_07B82B` | Despawn. |

The kill mechanic: one egg hit OR stomp (via `$7D38,x` "held-by"
link) routes to state $0006 with the death animation `$7402 = $05`.
Sluggies are one-shot kills regardless of body-segment, unlike the
Unshaven boss which needs phase-gated egg hits.

### 3.13 $154 SharkChomp (Bank0D)

Giant fish that lunges from below the water. Unusually for the
family, the Init has a **deferred-spawn pattern**: the sprite spawns
in level data but doesn't activate until Yoshi-X is close enough to
the camera-relative left edge.

The Init compares `$70E2,x - !RAM_YI_Global_Layer1XPosLo` against
`$FFB0`: if BMI (= Yoshi off-camera-to-the-left), the sprite parks
with hitbox disabled (`$74A2 = $00FF`) and status = $0002 (waiting),
and returns without activating. Once Yoshi crosses the threshold the
"active" path runs: calls `CODE_0DA4CA` (SuperFX render init),
clears facing, primes `701902 = $FFE8` (Y-offset), hitbox `$74A2 =
$0007`, X-vel cap `$7540 = $0008`, target X-speed `701900 = $0400`,
**reconfigures `MainScreenLayers = $15`** (OBJ+BG1+BG3 on main), and
seeds Layer-3 X/Y to frame the encounter cinematic.

Setting `!RAM_YI_Global_MainScreenLayers = $15` is the cinematic-mode
configuration -- Layer 3 is brought to the main screen with custom
X/Y, which is the trick that fades the surrounding water during the
shark's lunge. (The level-loader normally writes the standard
MainScreenLayers value; SharkChomp's Init overrides it on activation
and Main restores it on despawn.)

7-state main `DATA_0DA0F0` (`$0D:A0F0`):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0DA21E` | Lurk. Wait until camera-relative offset crosses zero, then advance. |
| `$02` | `CODE_0DA24A` | Surface. Pick random X-target from `DATA_0DA242 = $0220, $0260, $0280, $02C0`. |
| `$04` | `CODE_0DA270` | Lurk-fallback. Pick alternate X-target from `DATA_0DA268 = $0080, $00A0, $00C0, $0100`. |
| `$06` | (stub: `dw $0004`) | Unreachable in normal play -- the "dw value" form is the giveaway that this slot is a state-table sentinel rather than an executable address. |
| `$08` | (stub: `dw $0004`) | Same -- unreachable. |
| `$0A` | `CODE_0DA2F4` | Chomp / lunge. Accelerate $78,x toward $200; on $1400 cap hit, play sound `$56` (ThunderLakituAttacking6 -- repurposed as shark's surge sound), `DEC $16,x`. |
| `$0C` | `CODE_0DA332` | Sink / despawn. On Y crossing $0140, free slot + restore `MainScreenLayers AND $1313`. |

The two `dw $0004` entries are unusual: they're literal byte values
in the dispatch table rather than code addresses. The current `$76,x`
dispatcher never selects them (the state-transition logic skips $06
and $08), so they sit as documentation that the table once had two
more states that were removed during development. The fix would be
to renumber the states; the as-built code uses $00, $02, $04, $0A,
$0C as the live entries.

---

## 4. Habitat taxonomy

Splitting the family by **where** the sprite operates in vertical
space:

### 4.1 Fully underwater (water tile occupies most of the sprite's life)

- `$015` SubmarineTorpedo -- horizontal-only, never surfaces.
- `$06D` / `$06E` Hootie -- circles a fixed centre; both axes
  fully underwater.
- `$0E0` Preying Mantas -- vertical drift; surge cycles within the
  water column.
- `$0E1` Loch Nestor -- sine-circle drift, then bursts out for the
  inflate-pop emerge cycle.
- `$13F` / `$140` Swimming Flopsy Fish -- horizontal cruise with
  jump variants ($140) crossing the surface temporarily.

### 4.2 Water-line dwellers (anchor at surface, lunge above/below)

- `$02C` Lunge Fish -- waits submerged, leaps fully out of water.
- `$104` Jean De Fillet -- always anchored to the surface line; the
  Init's `FXCODE_0ACE2F` probe enforces this.
- `$143` Spray Fish -- anchored at surface; spout column rises above.
- `$0DF` Piscatory Pete -- alternates between underwater and arc
  jumping out.
- `$141` / `$142` Flopsy Fish jumps -- swim phase below + arc phase
  above water.
- `$145` / `$146` Sluggies -- swim toward shore, surface to "splash
  onto land", chase Yoshi briefly on land.

### 4.3 Shore / land-adjacent

- `$070` Clawdaddy -- side-walking on the sand/floor adjacent to
  water; never enters the water tile.
- `$154` Shark Chomp -- emerges from off-screen-water; the encounter
  cinematic transitions the player's view from a "water level" to a
  "shark threat" framing via `MainScreenLayers = $15`.

### 4.4 Bosses (cross-references)

- `$0A5` Nep-Enut / Gargantua Blargg -- documented in
  `docs/bossengine.md`. Lives underwater, lunges up. Same shape as
  Lunge Fish's state machine but with HP and phase progression.
- `$194` Blargg -- documented in `docs/bossengine.md`. Lives in
  lava, not water; included here only for state-machine
  similarity to Lunge Fish (the 4-state submerge/rise/attack/sink
  pattern).

---

## 5. Sub-family clusters

Where the family naturally clusters by shared behaviour:

### 5.1 The "lunge from below" cluster

Lunge Fish ($02C), Shark Chomp ($154), Piscatory Pete ($0DF), and
Nep-Enut ($0A5 boss) all share a "submerged-wait -> rise -> attack
-> sink -> cooldown" state pattern. The submerged-wait + cooldown
slots are nearly interchangeable across the cluster -- a generic
"hunter from below" state shape. The variation is in the attack
phase:

- Lunge Fish: parabolic grab.
- Shark Chomp: full-body horizontal lunge with cinematic layer
  override.
- Piscatory Pete: parabolic arc with optional player-homing via
  `FXCODE_09907C`.
- Nep-Enut: scripted multi-phase boss with paired projectile spawns.

### 5.2 The "Flopsy Fish" cluster

Four sprite IDs ($13F / $140 / $141 / $142) all flavoured as
flopsy fish but split across **two banks** with **two separate
Init/Main pairs**:

- Bank07 ($13F / $140): pure swim + optional jump. 7-state table.
- Bank05 ($141 / $142): swim + arc-jump, with $142 doing a triple-
  jump pattern via repeat counter. 4-state table.

The reason for the split: Bank05's variants live in different
levels (typically lake-shore segments) and the level data passes a
different spawn context. The fact that they're not unified is a
historical accident -- both banks predated the engine's per-bank
sprite-list cleanup and never got merged.

### 5.3 The "Sluggy" cluster (the underwater variants only)

$145 (Blue) and $146 (Pink) share Init/Main bodies, with Blue
preloading X-velocity from `DATA_07B69B` and Pink starting at rest.
**Do not confuse with $0D7 Sluggy the Unshaven** -- the boss has its
own Init/Main pair in Bank02 (`init_sluggy_unshaven` /
`main_sluggy_unshaven`) and uses GSU dyntile rendering with 7
segments per frame plus phase progression.

The collision detection between the two sets:
- `$145` / `$146`: 4-state, walking enemy, killed by stomp or one
  egg hit. Bank07.
- `$0D7`: GSU dyntile boss, killed by phase-gated egg hits to the
  head segment. Bank02.

Both are named "Sluggy" in the constants file (and in some
community references) -- the disambiguation is bank + sprite ID.

### 5.4 The "trig-table driven motion" cluster

Hootie ($06D / $06E), Loch Nestor ($0E1), Piscatory Pete ($0DF), and
to a lesser degree Spray Fish ($143) all use periodic trig tables to
drive motion:

- Hootie: SuperFX `FXCODE_0B8595` (plot on circle).
- Loch Nestor underwater drift: CPU-side
  `DATA_sine_lut_8bit_radians` / `_cosine_lut_8bit_radians` lookup.
- Pete + Loch Nestor approach: `FXCODE_09907C` (player-relative
  vector with multiplier).
- Spray Fish aim: CPU-side `DATA_07BEB4` arc-tangent LUT.

The mix of CPU-side and GSU-side trig is interesting: smooth circle
motion uses the GSU (because the trig multiplication is fast there),
but tiny linear LUTs stay on the CPU.

---

## 6. Variant-encoding patterns

The fish family uses three patterns to derive "which variant am I?"
from spawn data:

### 6.1 Pattern A: pixel-position parity

Used by Jean De Fillet, Preying Mantas, Piscatory Pete, Flopsy Fish
swim, Sluggies:

```
LDA $70E2,x : AND #$0010 : LSR x3 : ... : STA $7400,x  (or $76,x or $18,x)
```

The pixel-X bit 4 (= the "right vs left half of a tile") is the
variant selector. Two variants per sprite-ID using this scheme. This
is the same DP-mod-encoded variant trick described in
`docs/family-shyguys.md §3` for Shy Guy colour variants.

### 6.2 Pattern B: separate sprite-ID with fall-through Init

Used by Sluggy ($145 / $146) and Hootie ($06D / $06E):

```
YI_NorSpr145_BlueSluggy_Init:
init_sluggy_blue:
    ; ... blue-specific setup ...
    ; FALL THROUGH (no RTL)
YI_NorSpr146_PinkSluggy_Init:
init_sluggy_pink:
    ; ... shared init body ...
    RTL
```

Two sprite IDs at adjacent labels, with the "earlier" sprite
falling through to the "later" sprite's body. Cleaner than running
a CMP-then-branch at Init time.

### 6.3 Pattern C: level-ID lookup

Used by Swimming Flopsy Fish ($13F / $140) for the Lake Shore
Paradise carve-out:

```
LDA !RAM_YI_Level_CurrentLevelFromMapLo
CMP #!Define_YI_LevelID_LakeShoreParadise
BNE .common
; ... adjust spawn position 4 px lower ...
```

This is the only level-conditional Init in the family. Other
per-level variation goes through the level-loader's sprite-list
data (different sprite IDs spawning in different levels).

---

## 7. Open questions / unclarities

- **Shark Chomp dead states $06 and $08** (`DATA_0DA0F0` slots 3 and
  4 = `dw $0004`). These look like state-table sentinels left over
  from a development branch where the state machine had 8-9 states
  rather than 5. The current dispatcher never selects $06 or $08 --
  state-transitions skip them. Worth checking if these are reachable
  through any non-standard `STA $76,x` path (e.g., a held-by sprite
  forcing a state byte change), and what happens if they ARE reached
  -- the `dw $0004` would be interpreted as a JSR target into the
  middle of the bank, likely a crash. So far no path appears to
  activate them.

- **Piscatory Pete left-variant's $7401 facing**. The left variant
  uses `DATA_piscatory_pete_left_substate_ptr` with state $1 routed
  to `CODE_0CCFB2` (parabolic arc, no homing), while the right
  variant routes state $1 to `CODE_0CCF13` (homing via
  `FXCODE_09907C`). This is asymmetric: why is only the right-facing
  variant player-homing? Possibly a level-design choice (the right-
  facing fish spawn in places where the player approaches from above,
  needing homing for difficulty), but the asm doesn't explain it.

- **Lunge Fish `$701976` field usage in state $02**. The state
  reads `EXRAM_..._701976,x` and compares to $80 to decide between
  the splash and the sink branches. `$701976` isn't otherwise touched
  in the Lunge Fish handler -- it's set by an external module
  (probably the level-load init or a sibling sprite). What writes it?
  Likely the engine's "general-purpose accumulator" usage but worth
  verifying. SMWC's memory map labels this region as "sprite generic
  sub-state" but doesn't specify the Lunge Fish semantics.

- **Spray Fish $7AF6 timer interpretation**. Spray Fish state $02
  arms `$7AF6,x = $D1` (209 frames, ~3.5 sec at 60 fps), but the
  spray state ($04) only checks it for non-zero, not for a specific
  threshold. The actual "spray duration" appears to be governed by
  the $16,x counter ramping from 0 to $12 (18 steps) with per-step
  holds from `DATA_07BFE0`. So `$7AF6` is a hard upper-bound timeout
  rather than the primary timer. Confirming this would require a
  runtime trace of what happens when `$7AF6` expires before $16,x
  reaches $12.

- **Jean De Fillet's tileset-3 fast-path** (`CPY #$03 / BNE
  .probe_via_FX`). Tileset 3 skips the FXCODE_0ACE2F probe entirely
  and just bumps $7182 down by 4. Which level uses tileset 3, and
  is the assumption "water line is exactly at spawn Y - 4" tied to
  that specific level's BG layout? Inspecting LevelIDs.asm to find
  the tileset-3 levels would resolve this.

- **Flopsy Fish Bank07 vs Bank05 split rationale**. Both families
  share the "flopsy fish" visual identity but live in different
  banks with different state-machine architectures. Was this an
  authorial split (Bank07 = "boring underwater fish", Bank05 = "more
  interactive jump fish") or a historical accident from
  development-time sprite-table reshuffling? The naming convention
  (Init/Main labels) suggests intentional separation but the
  duplicated functionality argues for an accident.

---

## 8. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` -- canonical sprite IDs and
  one-line summaries for `$015`, `$02C`, `$06D`, `$06E`, `$070`,
  `$0DF`, `$0E0`, `$0E1`, `$104`, `$13F`, `$140`, `$141`, `$142`,
  `$143`, `$145`, `$146`, `$154`.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_main`, `spr_state_on_head_bop`, etc.) that runs every
  fish's Main and Init.
- `docs/bossengine.md` -- carries `$0A5` Nep-Enut / Gargantua
  Blargg and `$194` Blargg, the aquatic / submerged bosses. Also
  carries `$0D7` Sluggy the Unshaven -- the boss slime that shares
  a name (but no code) with the `$145` / `$146` underwater Sluggy
  variants documented in §3.12 above.
- `docs/family-boos.md` -- the Boo family, which overlaps habitat
  in the sewer / underwater levels (Dangling Ghost $090, the caged
  ghosts, etc.) but uses the Boo-family dispatcher rather than the
  per-fish state machines.
- `docs/family-clouds.md` -- Lakitu's water-level cloud variants
  and the cloud-spawned hazards that frame several water levels.
- `docs/family-shyguys.md` -- the variant-encoding patterns
  (`AND #$0010 / LSR x3`) used in fish are the same ones documented
  in shy-guy §3.
- `docs/leveldataengine.md` -- how sprite-list entries spawn fish
  slots; the level-data pipeline that produces `$70E2,x` /
  `$7182,x` spawn positions.
- `yi/Banks/Bank04.asm` -- `init_torpedo` (245), `main_torpedo`
  (283), `init_lunge_fish` (3153), `main_lunge_fish` (3188),
  `DATA_lunge_fish_state_ptr` (3169), all 10 lunge-fish state
  handlers (3262 .. 3565).
- `yi/Banks/Bank05.asm` -- `init_clawdaddy` (955),
  `main_clawdaddy` (1001), `DATA_clawdaddy_state_ptr` (979),
  `init_flopsy_fish_jumps` (15902), `main_flopsy_fish_jumps`
  (15968), `DATA_flopsy_fish_jumps_state_ptr` (15960).
- `yi/Banks/Bank07.asm` -- `init_flopsy_fish` (6354),
  `main_flopsy_fish_swim` (6405), `main_flopsy_fish_jump` (6421),
  `DATA_flopsy_fish_state_ptr` (6438), `init_sluggy_blue` (6881),
  `init_sluggy_pink` (6887), `main_sluggy` (6914),
  `DATA_sluggy_pink_blue_state_ptr` (6939), `init_spray_fish`
  (7874), `main_spray_fish` (7903), `DATA_spray_fish_state_ptr`
  (7926), `DATA_07BEB4` aim-LUT (7896).
- `yi/Banks/Bank0C.asm` -- `init_jean_de_fillet` (7233),
  `main_jean_de_fillet` (7297), `DATA_jean_de_fillet_state_ptr`
  (7312), `init_piscatory_pete` (10177), `main_piscatory_pete`
  (10209), `DATA_piscatory_pete_state_ptr` (10220),
  `init_preying_mantas` (10488), `main_preying_mantas` (10517),
  `DATA_preying_mantas_state_ptr` (10527), `init_loch_nestor`
  (10604), `main_loch_nestor` (10635),
  `DATA_loch_nestor_emerge_substate_ptr` (10697),
  `DATA_loch_nestor_underwater_substate_ptr` (10706).
- `yi/Banks/Bank0D.asm` -- `CODE_init_shark_chomp` (4242),
  `main_shark_chomp` (4297), `DATA_0DA0F0` (4284),
  `init_hootie_clockwise` (6535), `init_hootie_anticlockwise`
  (6525), `main_hootie` (6564), `DATA_0DB308` (6550).
- `yoshisisland-disassembly/disassembly/bank0{4,5,7,C,D}.asm` --
  Raidenthequick descriptive labels for every member of the
  family. Verified label-by-label.
- `ys_enmy*.asm` -- parallel engine-side dispatcher source.
- `ys_fish*.asm` -- parallel asm for the fish-family sub-state
  machines (state ptr table layouts cross-checked against ours).
- `ys_uwl*.asm` -- parallel asm for underwater-level handlers
  (Lunge Fish + Loch Nestor + Hootie); shares the surface-anchor
  pattern documented in §2.1.
