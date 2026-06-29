# YI Platforms family reference

Standalone reference for the Yoshi's Island "Yoshi can stand on it and
it moves" sprite family. Unlike the enemy families this is a
*functional* grouping: ~30 normal-sprite IDs spread across nine banks
that all answer the same engine-level contract -- they're "platforms",
meaning Yoshi's per-frame collision routine treats them as solid
ground, and they each layer their own motion model (rotation, swing,
rail-following, switch-toggled, wheel-spin, donut-fall, water-bob,
balloon-shrink, dog-walk, ...) on top of the engine's
ride-on-sprite primitive at `$61B6` / `$61B4`.

The family is unusual in three ways:

- **Bank diversity.** Where Bandits live in Bank0E and Shy Guys in
  Bank04+Bank07, platforms are scattered across Bank02 (BG3-rotating
  plank), Bank04 (the bulk -- ski-lift, BG3 boards, BG3 wheel, seesaw,
  log seesaw, line-guided rail set, donut lift, buoyant, rotating
  clusters), Bank05 (balloon, expanding block, checkered switchable,
  arrow wheels, double-ended arrow lift), Bank07 (Poochy), Bank0C
  (unstable snow), Bank0D (switch + spiked platforms, spinning log),
  Bank0E (swinging green platform), Bank11 (mini-battle checkered),
  and the per-routine emit of $03E thin platform (Bank00 or Bank0F
  depending on ROM version).
- **Shared SuperFX rope-arc / pivot math.** A handful of FXCODE
  routines do all the heavy work: `FXCODE_0B8595` (cosine LUT --
  rope-arc / single-point pendulum), `FXCODE_0B85D0` (4-orbit cluster
  -- the rotating-cluster sprites), `FXCODE_0B89E9` (rail-following
  path lookup -- the 10 line-guided platforms + the spiral), and
  `FXCODE_0B860A` (8-sample physics deflection -- the thin platform).
  See `docs/mchip.md` for the underlying GSU-2 conventions.
- **Aggressive sprite-ID sharing.** Many platform sprites fan out
  4-10 sprite IDs that share Init and Main bodies, dispatching on
  `SpriteID - $base` to pick palette / direction / variant. The
  10-variant line-guided rail family is the extreme case (§4); the
  4-variant rotating-cluster family is a close second (§1).

This doc complements:

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  every entry here layers its own state machine on top of. Every
  platform's `_Main` runs from `spr_state_main` ($03:9A90) while the
  state byte at `$70:0F00,x` stays `$10`.
- `docs/levelloader.md` -- BG3-sprite registration (when a platform
  asks for the level's BG3 tilemap to be its body, the level-loader
  must have allocated one or `CODE_02813E` will reject the spawn).
- `docs/mchip.md` -- the SuperFX FXCODE routines (`FXCODE_0B8595` etc.)
  the family relies on for pivot/rope-arc/rail math.
- `docs/leveldataengine.md` -- how each platform's slot gets
  populated from a level's sprite-list entry.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank02.asm` ($039), `Bank04.asm` (the bulk), `Bank05.asm`
(balloon / expanding / checkered / arrow wheels), `Bank07.asm`
(Poochy $0FF), `Bank0C.asm` (unstable snow $195/$196), `Bank0D.asm`
(switch/spike, spinning log), `Bank0E.asm` (swinging green platform
$09A), `Bank11.asm` (mini-battle checkered $1B4), and
`yi/Routines/ROUTINE_YI_NorSpr03E_ThinPlatform.asm` ($03E thin
platform). Cross-verified against `yoshisisland-disassembly/disassembly/bank04.asm`
etc. for descriptive labels (`init_donut_lift`, `init_seesaw`,
`init_arrow_wheel`, `init_line_guided_platform`, `init_skinny_platform`,
`init_spinning_wooden_platform`, `init_spinning_log`, `init_balloon`,
`init_expansion_block`, `init_checkered_block`, `init_arrow_wheel`,
`init_buoyant_round_platform`, `init_unbalanced_snowy_platform`,
`init_flatbed_ferry_green`, `init_poochy`) and the parallel sources
`ys_floor.asm`, `ys_lift.asm`, `ys_swing.asm`, `ys_pl*.asm`.

---

## 1. Family at a glance

Thirty-one sprites and one ROUTINE file across nine banks. Sub-family
columns map to sections §1-§7 below.

| ID | Name | Bank | Init | Main | Sub-family |
|---|---|---|---|---|---|
| `$01A` | SkiLift | 04 | Bank04:967 `init_ski_lift` | Bank04:1004 `main_ski_lift` | §7 |
| `$01D` | DrFreezegoodOnSkiLift | 04 | Bank04:936 `init_freezegood_ski_lift` | Bank04:1005 shared with $01A | §7 |
| `$039` | HorizontalRotatingPlank | 02 | Bank02:1564 `init_spinning_wooden_platform` | Bank02:1624 `main_spinning_wooden_platform` | §2 |
| `$03D` | LargeSeesaw | 04 | Bank04:6602 `init_large_seesaw` | Bank04:6635 `main_large_seesaw` | §2 |
| `$03E` | ThinPlatform | -- | ROUTINE `init_skinny_platform` ($00:878A or $0F94D6) | ROUTINE `main_skinny_platform` | §7 |
| `$050` | GreyRotatingWoodenBoard | 04 | Bank04:4559 `init_board_bg3` | Bank04:4585 `main_board_bg3` | §2 |
| `$051` | LargeWheel | 04 | Bank04:4782 `init_large_wheel` | Bank04:4808 `main_large_wheel` | §5 |
| `$052` | BalloonPlatform | 05 | Bank05:6876 `init_balloon` | Bank05:6950 `main_balloon` | §7 |
| `$055` | 4GreenRotatingPlatforms | 04 | Bank04:8270 `init_four_rotating_platforms` | Bank04:8302 `main_four_rotating_platforms` | §1 |
| `$056` | 4PinkRotatingPlatforms | 04 | Bank04:8271 shared with $055 | Bank04:8303 shared with $055 | §1 |
| `$05E` | BrownWoodenBoard (manual) | 04 | Bank04:4986 `init_plank_bg3` | Bank04:5013 `main_plank_bg3` | §2 |
| `$05F` | BrownWoodenBoard (auto) | 04 | Bank04:4987 shared with $05E | Bank04:5014 shared with $05E | §2 |
| `$064` | 4AutoRotatingPinkPlatforms | 04 | Bank04:8258 `init_four_auto_rotating_pink_platforms` | Bank04:8304 shared with $055 | §1 |
| `$07F` | LogSeesawPlatform | 04 | Bank04:6034 `init_log_seesaw_platform` | Bank04:6051 `main_log_seesaw_platform` | §2 |
| `$089` | HorizontalMovingRedPlatform | 04 | Bank04:5240 `init_red_platform` | Bank04:5286 `main_red_platform` | §4 |
| `$08A` | VerticalMovingPinkPlatform | 04 | Bank04:5315 `init_pink_platform` | Bank04:5344 `main_pink_platform` | §4 |
| `$094` | ExpandingBlock | 05 | Bank05:3658 `init_expansion_block` | Bank05:3678 `main_expansion_block` | §7 |
| `$095` | BlueCheckeredBlock | 05 | Bank05:3986 `init_checkered_block` | Bank05:4015 `main_checkered_block` | §3 |
| `$096` | RedCheckeredBlock | 05 | Bank05:3987 shared with $095 | Bank05:4016 shared with $095 | §3 |
| `$09A` | SwingingGreenPlatform | 0E | Bank0E:268 `init_flatbed_ferry_green` | Bank0E:285 `main_flatbed_ferry_green` | §7 |
| `$0FF` | Poochy | 07 | Bank07:2826 `init_poochy` | Bank07:2846 `main_poochy` | §7 |
| `$116` | BuoyantRoundPlatform | 04 | Bank04:6405 `init_buoyant_round_platform` | Bank04:6425 `main_buoyant_round_platform` | §6 |
| `$117` | DonutLift (small) | 04 | Bank04:9369 `init_donut_lift` | Bank04:9397 `main_donut_lift` | §6 |
| `$118` | LargeDonutLift | 04 | Bank04:9370 shared with $117 | Bank04:9398 shared with $117 | §6 |
| `$11E` | BrownArrowWheel | 05 | Bank05:14722 `init_arrow_wheel` | Bank05:14742 `main_arrow_wheel` | §5 |
| `$11F` | BlueArrowWheel | 05 | Bank05:14723 shared with $11E | Bank05:14743 shared with $11E | §5 |
| `$120` | DoubleEndedArrowLift | 05 | Bank05:15154 `init_double_ended_arrow_lift` | Bank05:15196 `main_double_ended_arrow_lift` | §5 |
| `$15C` | GreenRotatingPlatformSwitch | 0D | Bank0D:4813 `init_spiked_platform_switch` | Bank0D:4832 `main_spiked_platform_switch` | §3 |
| `$15D` | RedRotatingPlatformSwitch | 0D | Bank0D:4814 shared with $15C | Bank0D:4833 shared with $15C | §3 |
| `$15E` | 4PinkRotatingPlatforms+ShyGuys | 04 | Bank04:8214 `init_four_rotating_platforms_with_shyguys` | Bank04:8305 shared with $055 | §1 |
| `$15F` | GreenSpikedPlatform | 0D | Bank0D:4865 `init_spiked_platform` | Bank0D:4914 `main_spiked_platform` | §3 |
| `$160` | RedSpikedPlatform | 0D | Bank0D:4866 shared with $15F | Bank0D:4915 shared with $15F | §3 |
| `$162` | DoubleSpikePlatformWithSwitch | 0D | Bank0D:5265 `init_two_spiked_platforms_with_switch` | Bank0D:5290 `main_two_spiked_platforms_with_switch` | §3 |
| `$180` | SpinningLog | 0D | Bank0D:7427 `init_spinning_log` | Bank0D:7446 `main_spinning_log` | §2 |
| `$185` | MovingLineGuidedGreenLeft | 04 | Bank04:5486 `init_moving_line_guided_platform` | Bank04:5529 `main_line_guided_platform` | §4 |
| `$186` | MovingLineGuidedGreenRight | 04 | Bank04:5487 shared with $185 | Bank04:5530 shared with $185 | §4 |
| `$187` | MovingLineGuidedYellowLeft | 04 | Bank04:5488 shared with $185 | Bank04:5531 shared with $185 | §4 |
| `$188` | MovingLineGuidedYellowRight | 04 | Bank04:5489 shared with $185 | Bank04:5532 shared with $185 | §4 |
| `$189` | LineGuidedGreenLeft (stationary) | 04 | Bank04:5501 `init_line_guided_platform` | Bank04:5533 shared with $185 | §4 |
| `$18A` | LineGuidedGreenRight (stationary) | 04 | Bank04:5502 shared with $189 | Bank04:5534 shared with $185 | §4 |
| `$18B` | LineGuidedYellowLeft (stationary) | 04 | Bank04:5503 shared with $189 | Bank04:5535 shared with $185 | §4 |
| `$18C` | LineGuidedYellowRight (stationary) | 04 | Bank04:5504 shared with $189 | Bank04:5536 shared with $185 | §4 |
| `$18D` | LineGuidedRedLeft (stationary) | 04 | Bank04:5505 shared with $189 | Bank04:5537 shared with $185 | §4 |
| `$18E` | LineGuidedGreenRight (alt stationary) | 04 | Bank04:5506 shared with $189 | Bank04:5538 shared with $185 | §4 |
| `$18F` | SpiralPlatform | 04 | Bank04:5708 `init_spiral_platform` | Bank04:5718 `main_spiral_platform` | §2 |
| `$195` | SmallUnstableSnowPlatform | 0C | Bank0C:871 `init_small_unstable_snow_platform` | Bank0C:939 `main_small_unstable_snow_platform` | §6 |
| `$196` | LargeUnstableSnowPlatform | 0C | Bank0C:899 `init_unstable_snow_platform` | Bank0C:1066 `main_unstable_snow_platform` | §6 |
| `$1B4` | MinigameCheckeredPlatform | 11 | Bank11:3375 (no helper name) | Bank11:3444 (no helper name) | §7 |

Three quick taxonomy observations:

- **`$055`/`$056`/`$064`/`$15E`** all share one `_Main` body in Bank04
  (lines 8402-8405 collapse to a single label) -- the most-shared Main
  in the family. The variant select is `SpriteID - $055` (manual vs.
  auto) plus a per-ID branch in the shared Main.
- **`$185`..`$18E`** (ten consecutive sprite IDs) all share one `_Main`
  body (Bank04:5585-5594, ten labels at one address). The "moving"
  versus "stationary" split is by **Init**: `$185`-`$188` get the
  velocity-loading Init at line 5540; `$189`-`$18E` get the
  zero-velocity Init at 5556. After that they merge.
- **`$117`/`$118`** (donut + large donut) share Init *and* Main, with
  a one-byte `LDY` branch at the top of Init picking the collision
  box width (`$08` for small, `$10` for large).

The full set of sprites that touch the engine's "ride this sprite"
contract (`$61B6`, `$61B4`) is even larger than the 31 entries above
-- it also includes movable enemies like Lakitu's cloud and a few
boss platforms -- but those are documented in their respective family
docs. This doc covers only the pure "platform" sprites where the
platform IS the gameplay object.

---

## 2. Single-piece rotating / swinging boards

The non-cluster pivot-mounted platforms. All seven of these have a
single physical body that rotates, swings, or tips around a fixed
pivot. Behaviourally they range from full continuous rotation (the
auto-rotating boards, the spinning log) through weight-tipping
seesaws (the large seesaw, the log seesaw) to one-shot rotation that
resets when Yoshi steps off (the manual brown board).

### 2.1 $039 Horizontal Rotating Plank (BG3 HDMA-rotated)

The architecturally weirdest member of the family. Init at Bank02:1564
programs four HDMA channels (1/2/3/6) with per-scanline data from
`$7E528C` (105 bytes seeded as `$09`-fill, then runtime-updated by
the Main). The "rotation" is purely an HDMA-driven scanline-shear
effect on BG3 -- there's no SuperFX involved.

Init writes to seven distinct hardware-state regions:
- HDMA[$01..$06].Parameters from local data tables.
- HDMA[$01..$06].IndirectSourceBank = `$7E`.
- `$7E5C18` 7-byte seed.
- `$7E528C` 112-byte HDMA-table init (filled with `$09`).
- The `YI_Global_PaletteMirror[$0B]` palette block.

After all that the per-slot state is just:
- `$70E2,x` (X) `|= $0008` (snap to half-tile).
- `$7182,x` (Y) `--` (one-pixel up).
- `$16,x = $0040` (initial angle, 256 steps = 1 full rotation).

Main reads `DATA_cosine_lut_8bit_radians` (the global cosine LUT) at
index `$16,x * 2`, multiplies by `$00..$FF` from the HDMA-mapped
plank cells via PPU Mode-7 multiplication ($211B/$211C), then does
the same with the sine LUT for player-Y placement. The angle ticks
every frame at line 7-end (`ADC #$FFFF / AND #$00FF`) so it rotates
once every 256 frames (~4.3 seconds). Yoshi collision uses a
$70-pixel-wide reach window on the angle's X component.

This is one of two sprites in the family that uses BG3 indirect HDMA
instead of SuperFX morphing -- the other is the much smaller and
similar Grey Rotating Wooden Board $050.

### 2.2 $050 Grey Rotating Wooden BG3 Board

The simpler BG3-rotating board. Init at Bank04:4559 (`init_board_bg3`)
runs three steps:

```
init_board_bg3:
    JSL CODE_02813E                 ; register BG3 sprite -- see §8.1
    LDA $70E2,x : SBC #$0008 : STA $70E2,x   ; X -= 8
    LDA #$0140  : STA $7A36,x                 ; rotation period = $140 steps
    RTL
```

The first JSL is the **BG3 sprite-registration guard**: only one BG3
sprite can be alive at a time (the level header allocates exactly
one BG3 tilemap region). `CODE_02813E` increments `$0CB2` and
returns; the guard at `CODE_028183` (Bank02:171) tests `$0CB2 != 0`
on subsequent BG3 spawns and unspawns the second sprite via
`CODE_03A31E`. Effectively: if a level already has a BG3 sprite
active, this board will despawn rather than corrupt the BG3 layer.

Main runs a small angle-stepper that:
1. Reads global freeze flags (`$0CB2`, `!RAM_YI_Level_TouchedFuzzyMosaicTimerLo`,
   `!RAM_YI_Level_ItemBeingUsed`); if any is set, skips motion and goes
   straight to `CODE_04A250` (the BG3 redraw).
2. Otherwise calls `CODE_04A280` (the rope-arc helper, see §8.2) with
   `Y = $20` and `A = $0030` to test Yoshi-vs-board contact.
3. On contact: writes `$7A38,x = $0008` (acceleration), `$7A36,x +=
   $0008` (angle).
4. On no-contact: decays the angle by $10/frame back to the rest
   position, plays `!Define_YI_SoundID40_OpenDoor` when crossing zero.

So the grey board only moves when Yoshi pushes on it; release and it
returns to neutral. The sound effect is reused from "door open" (the
SoundID name `$40` is just whatever was vacant in the table -- the
actual sample is a creak).

### 2.3 $05E manual / $05F auto brown wooden board

Init `init_plank_bg3` is two lines:

```
init_plank_bg3:
    INC $0DF9    ; bump cluster active-count
    RTL
```

There's no BG3 spawn-guard, no SuperFX setup -- this is because
$05E/$05F **don't own** the BG3 layer (some other BG3 sprite -- a
falling-wall sprite or one of the BG3 boards -- owns it). The plank
graphics piggyback on the *existing* BG3 setup; instead the planks
do all their visual work through SuperFX render at `FXCODE_08D486`.

Main `main_plank_bg3` does the cluster's phase sync at the top:

```
LDA $0030 ; frame counter mod 60 (or similar)
CMP $0DF7 ; compare against last-tick stamp
BEQ skip_init_pass
STA $0DF7 ; first plank for this frame -- update phase
LDA $0DF9 : STA $0DFB ; snapshot count for the per-frame divide
JSL FXCODE_08D46A    ; cluster-shared SuperFX (LOC count etc.)
```

After that the Main dispatches via `DATA_plank_bg3_state_ptr` (two
entries, `SpriteID - $05E` selects):
- $05E -> `CODE_plank_bg3_state_00_manual_swing` (Bank04:5186)
- $05F -> `CODE_plank_bg3_state_01_auto_rotate` (Bank04:5243)

Manual variant ($05E): Yoshi-push via `CODE_04A280` adds to angle
$7A36; if angle hits $4000 (max), clamp; if Yoshi stops pushing
($7A38 zero), gravity-decay $7A36 by $0003/frame; if angle reaches
$0200, snap to 0 and reset.

Auto variant ($05F): always advances $7A36 by $0010/frame (plus a
small $7A38 ramp). When the angle goes past sign-bit (full half-
rotation done), arm `$7A96,x` cooldown to $60 or $80 based on
`$70E2,x` bit-4 (so half the auto-boards in a level rotate at one
phase and half at the other). On cooldown expiry, reset and rotate
the other direction.

The cluster phase sync makes all `$05E/$05F` planks in a level move
in step. **`$0DF9` = count of planks alive; `$0DFB` = current-tick
counter; `$0DF7` = last-tick stamp.** When the final plank for a
frame ticks (`DEC $0DFB / BEQ`), it triggers `CODE_04A50E` which
commits the palette-mirror updates for the whole cluster -- a per-
cluster vsync.

### 2.4 $03D Large Two-Platform Seesaw

The cinema-scale double-decker seesaw. Init at Bank04:6602 has a
**first-spawn-only** guard via `$0CB2` (the global "a BG3 platform is
already active" flag, shared across all big BG3 platforms -- §8.1):

```
init_large_seesaw:
    LDA $0CB2 : BEQ proceed
    JML CODE_03A31E   ; a BG3 platform already exists -- despawn this one
proceed:
    INC $0CB2
    LDA #$0078 / #$FF88 (by $0073)  ; X offset for left/right entry
    ADC $70E2,x : STA $70E2,x
    ... load palette block DATA_5FE33E -> mirror[$01..$05] ...
    STA $7A36,x = !RAM_YI_Global_MainScreenLayers
    STA $701900 = $1000   ; initial Y-deflection (the seesaw rests level)
```

Note: only one large seesaw can be alive at once (the `$0CB2` mutex),
and `$0073` -- the global **horizontal scroll-direction** flag (0 =
scrolling right, 2 = scrolling left; set by `CODE_04FD28`, see §8.8)
-- toggles the `$0078` / `$FF88` offset so the seesaw nudges its X
toward the edge Yoshi scrolled in from. This is why the seesaw is
placed in pairs: whichever copy crosses the leading edge first claims
the slot and self-positions; the other despawns. Full mechanism in
§8.8.

Main dispatches:
1. `CODE_04B2B3` -- BG3 region clip/redraw.
2. `CODE_03AF23` -- engine gravity & sub-status.
3. `CODE_04B169` -- tilt-physics (calls the seesaw tilt helper
   `CODE_04AEDF` with `Y = $04`).
4. `CODE_04B191` -- Yoshi-stand interaction (rolls the player's Y
   position by the current tilt and applies stand-feet pivot xform
   via `CODE_04AF4D`; see §8.3 / §8.4).

The tilt limit is `DATA_04AED7+$04` (the third pair, `$E000/$2001`)
which is wider than the other seesaws' `$C000/$4001` -- this seesaw
has a higher allowed tilt because both platforms (one on each end
of the pivot) are individually larger.

The seesaw plays `!Define_YI_SoundID1F_HitHead` when tilt hits the
extreme (sample: the standard "ouch" hit-head sound -- repurposed
here as a wood-creak-at-extreme).

### 2.5 $07F Log Seesaw Platform

A single horizontal log on a central pivot that tips toward whichever
side Yoshi stands on. Init at Bank04:6034 is the canonical pivot
setup:

```
init_log_seesaw_platform:
    JSL CODE_03AE60   ; allocate a pivot/parent slot (see §8.5)
    JSL CODE_04AE9D   ; register the SuperFX OAM template (FXCODE_088205)
    STZ $7400,x       ; facing = 0 (no facing for a horizontal log)
    LDA #$2000 : STA $701900   ; initial pivot angle (= 0 tilt, sign-bit clear)
    RTL
```

Main runs the tilt-with-Yoshi physics via `CODE_04AEDF` with
`Y = $00` (= `DATA_04AED7` index 0 = `$C000/$4001` -- the narrowest
tilt limits in the table). The Y-velocity table `DATA_04ACCF` is
just `{$FF00, $0100}` -- when Yoshi is on the left side, the log
tips left (Y-vel = $0100 = down); on the right, Y-vel = $FF00 (up).

The log specifically uses `DATA_04ACCF` and `DATA_04ACCB` for its
tip-velocity vectors; the helper at `CODE_04AF4D` (§8.4) does the
shared pivot transform that maps Yoshi's foot-pos into the log's
rotated frame.

### 2.6 $180 Spinning Log

A horizontal log that **rolls** when Yoshi steps on it (different
from $07F which tips). Init at Bank0D:7427 runs `CODE_03AE60` (pivot
alloc) + `CODE_0DBA3D` (the SuperFX OAM template register, FXCODE_088205,
same as $07F) and sets `$7BB6,x = $000C` (a narrow 12-pixel collision
box on top of the log -- you only roll if you land cleanly).

Main has a 2-entry sub-state table at `DATA_0DBA22`:
- $76 = 0 (`CODE_0DBB1F`): idle. Just waits for Yoshi to step on; on
  contact arms `$7A96,x = $0080` cooldown and switches to state 1.
- $76 = 2 (`CODE_0DBB2E`): spinning. Increments `$7A38,x` by $0010/
  frame (angle). The display ($7402,x) reads the angle's bit 7 to
  pick "log right-facing" vs "log left-facing" sprite tiles.

The Yoshi push routine `CODE_0DBA86` does an LOS check via
`FXCODE_0BBCF8` (rail-direction lookup) followed by `FXCODE_0B8595`
(cosine) to compute push-direction. Push opposite Yoshi's direction
of run via `$60FC` (player input bits). Sets `$60AA` (player
X-velocity) to roll Yoshi the *other* way -- this is the platformer
"log on a stream" mechanic.

### 2.7 $18F Spiral Platform

A standing platform that orbits a fixed pivot point. Init runs
`CODE_03AE60` (pivot alloc) + sets `$701900,x = $0080` and zeros
`$7400,x`. Main runs the full rail-following pipeline:

1. `CODE_03AA52` (sprite-parent inherit position).
2. `CODE_03AF23` (engine gravity).
3. `CODE_04AAA2` (call `FXCODE_0B89E9` -- the rail-table lookup,
   shared with all line-guided platforms in §4).
4. Update X/Y delta as `(new pos - old pos)`.
5. `FXCODE_0BBCF8` (rail-direction normalisation -- if `$701900,x`
   is sign-set, this is a "passive" platform that only moves when
   Yoshi is on it).
6. `CODE_04AABE` (Yoshi-on-platform Y-snap via `FXCODE_0B8595` cosine
   shift).
7. `CODE_04ABC6` (collision)/`CODE_04ABED` (chase)/`CODE_04AC61`
   (rotate the OAM tile bank by the current angle).

The "spiral" name comes from the rail-table itself, which is a curved
path (not a straight rail like §4's platforms). The same rail-Main
runs for all line-guided variants; the spiral just selects a different
rail table via `FXCODE_0B89E9`'s implicit table-lookup based on the
slot's `$75E0,x` (the rail-id).

---

## 3. Switch-driven platforms

The "egg/projectile hits switch -> platform mode flips" set. Five
sprites here use a paired-platform-controlled-by-switch pattern.

### 3.1 The $15C/$15D switch + $15F/$160 platform pair

The base mechanic for "egg hits a colored switch to flip the
rotation direction of a colored pair of spiked platforms". Two
parallel state pairs:

- $15C (green switch) <-> $15F (green spiked platforms): index $00.
- $15D (red switch) <-> $160 (red spiked platforms): index $02.

The shared encoding: `SpriteID - $15C` (or `SpriteID - $15F`) ASL'd
gives the pair-index `$00` or `$02`, used to index into per-pair
global state:

```
init_spiked_platform_switch:                ; sprites $15C / $15D
    LDA EXRAM_NorSpr_SpriteID,x
    SEC : SBC #!Define_YI_NorSpr15C_GreenRotatingPlatformSwitch
    ASL                                     ; -> 0 or 2
    STA $78,x                               ; cache pair-index in $78
    STZ $7400,x
    LDA $7182,x : STA $701902,x             ; remember Y rest pos
    RTL
```

Main `main_spiked_platform_switch` compares two global "switch-mode"
words `$0FD1,y` vs `$0FD5,y` (where `y = $78,x = 0 or 2`); when
they're equal (i.e. the per-pair "current mode" matches the per-pair
"target mode"), the platforms are at steady state. If different,
calls `CODE_0DAA6B` which gradually rotates the platforms toward the
new target mode.

The platform's Init `init_spiked_platform` is more elaborate -- it
allocates two pivots (the platform AND its mirror partner):

```
init_spiked_platform:                        ; sprites $15F / $160
    LDA EXRAM_NorSpr_SpriteID,x
    SEC : SBC #!Define_YI_NorSpr15F_GreenSpikedPlatform
    ASL : STA $78,x : TAY                    ; pair-index 0 or 2 (also Y)
    LDA $0FC1,y                              ; pair already initialised?
    BNE .second_platform                     ; -- yes, skip the alloc
    JSL CODE_03AE60                          ; alloc primary pivot
    LDY $78,x
    LDA $7722,x : INC : STA $0FC1,y          ; cache pivot ID (+1)
    JSL CODE_03AD74                          ; alloc partner pivot
    BCS .ok_partner
    LDY $78,x : STZ $0FC1,y                  ; partner-alloc failed
    JML CODE_03A31E                          ; -- bail; despawn self
.ok_partner:
    LDY $78,x
    LDA $7722,x : INC : STA $0FC5,y          ; cache partner-id (+1)
    LDA #$FFFF : STA $7722,x                 ; clear local pivot ref
    JSR CODE_0DA712                          ; partner setup
.second_platform:
    LDY $78,x
    LDA $0FCD,y : INC : STA $0FCD,y          ; increment per-pair active-count
    STZ $7400,x
    LDA #$0019 : STA $7BB6,x                 ; collision box
    LDA #$0007 : STA $7BB8,x
    RTL
```

Two slot-fields per pair: `$0FC1,y` (primary pivot id +1, or 0 =
"not yet alloc'd") and `$0FC5,y` (partner pivot id +1). `$0FCD,y` is
the per-pair active-platform count -- when it drops to 0 during the
despawn path in main, the pair releases both pivots.

Main runs a 5-step pipeline on the platform:
1. `CODE_0DA5D7` -- pull both pivot positions, mirror current angle
   from `$0FD9..$0FE5` into the OAM render coords.
2. `CODE_0DA69C` -- despawn-if-offscreen (releases pivots if last
   alive).
3. `CODE_0DA7E6` -- the rotation phase.
4. `CODE_0DA8B8` -- collision response (the actual `$61B6` lock).
5. `CODE_0DA6DC` -- post-frame cleanup.

The state byte `$76,x` is used per platform-pair-index to flip the
direction of rotation; the switch `$15C/$15D` writes to `$0FD5,y`
when struck, and the platform's Main eases `$0FD1,y` toward
`$0FD5,y` over time.

### 3.2 $162 DoubleSpikePlatformWithSwitch

A single sprite ID that manages **all three pieces** (one switch +
two platforms) in one slot. Init runs:

```
init_two_spiked_platforms_with_switch:
    JSL CODE_03AE60                       ; alloc primary pivot
    LDA $7722,x : STA $701902,x           ; cache primary pivot-id in 701902
    JSL CODE_03AD74                       ; alloc partner pivot
    BCS proceed
    LDA $701902,x : STA $7722,x           ; partner-alloc failed -- restore primary
    JML CODE_03A31E                       ; -- bail
proceed:
    JSR CODE_0DAB6A
    STZ $701900,x : STZ $7400,x
    LDA #$0008 : STA $7BB8,x              ; collision box height
    RTL
```

Main runs a 6-step pipeline that's the same shape as the §3.1 spiked
platform but with **three** sub-render bodies (the switch sprite +
the two platforms) instead of one platform mirrored from a partner:

1. `CODE_0DA911` (which is `CODE_0DA922` if not frozen) -- three
   parallel `CODE_03AA60` calls, each at a different sub-offset
   ($40, $20, $60) into the SuperFX OAM scratch. This is the
   3-segment render.
2. `CODE_03AF23` -- engine gravity.
3. `CODE_0DAC2D` -- rotate the three segments.
4. `CODE_0DAA52` -- hit detection for the central switch.
5. `CODE_0DAC43` -- platform rotation (uses the same `$701900` /
   `$7A38` machinery as §3.1).
6. `CODE_0DAF16` -- switch state machine.
7. `CODE_0DAAF5` -- player-on-platform Y-snap.

This is one of the most pipeline-heavy Mains in the family (7 JSRs)
because it has to render and animate three rotated sprites in one
slot.

### 3.3 $095/$096 Checkered Switchable Block

A pair of switchable solid/air blocks: when the `! switch` global
flag toggles, $095 (blue) becomes solid and $096 (red) becomes air,
or vice versa. Init `init_checkered_block` at Bank05:3986:

```
init_checkered_block:
    JSL CODE_03AE60               ; alloc pivot
    LDA #$0100
    STA $7A36,x  ; expansion scale X (= 1.0 = full)
    STA $7A38,x  ; expansion scale Y
    STZ $16,x    ; orient flag (0 = horizontal, 1 = vertical)
    JSR CODE_059E99  ; SuperFX OAM template register
    RTL
```

Main has a 4-entry sub-state ptr `DATA_checkered_block_state_ptr`
(line 4327):
- State 0 (`CODE_059EF3`): horizontal sweep -- the block moves
  horizontally, leaving behind an after-image trail.
- State 1 (`CODE_059F50`): vertical sweep -- like state 0 but Y.
- States 2/3 (`CODE_0580C2`): shared engine stub (GSU delta-facing).

The state transitions: state 0 -> state 1 happens when `$0EED` (the
! switch flag) is toggled, switching the block's "active" status.
The block plays `!Define_YI_SoundID05_Powerup` on toggle.

Note the interesting cross-bank reuse at lines 4557-4564: when the
state machine wraps around, it dispatches to either
`CODE_init_red_platform` (Bank04, sprite $089) or
`CODE_init_pink_platform` (Bank04, sprite $08A) to re-arm the
horizontal/vertical sweep. This is rare cross-bank reuse -- the
checkered block reuses the §4 moving-platform infrastructure for its
post-toggle motion.

---

## 4. Line-guided / rail platforms

The biggest sub-family by sprite-ID count: 10 line-guided rail
platforms (`$185`-`$18E`) plus 2 fixed-sweep platforms (`$089`,
`$08A`). The rail platforms all share **one** Main body in Bank04:5585-
5594 (ten labels at one address) and split into two Inits by velocity
class.

### 4.1 The 10-variant rail family ($185-$18E)

This is the most aggressively-shared family in the file. The Main
body at Bank04:5585 carries ten labels:

```
YI_NorSpr185_MovingLineGuidedGreenPlatformLeft_Main:
YI_NorSpr186_MovingLineGuidedGreenPlatformRight_Main:
YI_NorSpr187_MovingLineGuidedYellowPlatformLeft_Main:
YI_NorSpr188_MovingLineGuidedYellowPlatformRight_Main:
YI_NorSpr189_LineGuidedGreenPlatformLeft_Main:
YI_NorSpr18A_LineGuidedGreenPlatformRight_Main:
YI_NorSpr18B_LineGuidedYellowPlatformLeft_Main:
YI_NorSpr18C_LineGuidedYellowPlatformRight_Main:
YI_NorSpr18D_LineGuidedRedPlatformLeft_Main:
YI_NorSpr18E_LineGuidedGreenPlatformRight_Main:
main_line_guided_platform:
```

All ten platforms dispatch to the same `JSL.l CODE_04A9FD` (the rail
lookup, see below), the same Yoshi-stand handler `CODE_04A78E`
(shared with the simple moving platforms $089/$08A), and the same
direction-update logic at `CODE_04A92A`.

The 4-byte direction table is:

```
DATA_04A866:
    dw $AA00, $0000, $5400, $0001, $0000, $0004
```

This is parsed by the Init as three (X-speed, Y-speed) pairs:
- Index 0 = `($AA00, $0000)` = "negative X, no Y" (= moves left).
- Index 2 = `($5400, $0001)` = "positive X, $0001 Y" (= moves right + tiny down-drift).
- Index 4 = `($0000, $0004)` = "no X, slight positive Y" (= stationary but with leaky drift).

The variant encoding scheme is the **two-level split**:

**Level 1 -- moving vs stationary**. Two distinct Init labels:

```
YI_NorSpr185...188_Init:                ; "moving" variants
init_moving_line_guided_platform:
    LDA EXRAM_NorSpr_SpriteID,x
    SEC : SBC #$185
    AND #$0002                          ; even/odd: pick green-pair or yellow-pair velocity
    ASL : TAY
    LDA DATA_04A866,y : STA $7A36,x     ; X-speed
    LDA DATA_04A866+$02,y : STA $7A38,x ; Y-speed
    ; FALL THROUGH:
YI_NorSpr189...18E_Init:                ; "stationary" variants
init_line_guided_platform:
    LDA #$0080 : STA $701900,x         ; "passive" rail flag
    LDA #$0185
    AND #$0001
    STA $00
    LDA EXRAM_NorSpr_SpriteID,x
    SEC : SBC #$185
    AND #$0001                          ; bit-0 -> direction flip
    CMP $00
    BNE skip_flip
    LDA #$8000 : STA $16,x              ; arm "flip-on-first-tick" bit
skip_flip:
    LDA #$0014 : STA $7BB6,x            ; collision width
    LDA #$0008 : STA $7BB8,x            ; collision height
    RTL
```

The moving variants fall through to the stationary Init -- they
all share the post-velocity setup (`$701900` ratio, direction-flip
machinery, collision box). The clever bit: the moving variants
write `$0000` to `$701900,x` BEFORE falling through (since they
never reach the `LDA #$0080 : STA $701900,x` line), while the
stationary variants land on `$0080` -- and that's exactly what the
Main checks at line 5604:

```
LDY $701900,x
BMI .stationary_passive_branch   ; -- "stationary" set $8000 etc.
; ... moving branch: just step by $7A36/$7A38 ...
```

So the `$701900` byte serves *triple* duty here: a moving/stationary
flag (high bit), a rail-id register (low byte), and a per-state
modifier (mid bits).

**Level 2 -- which two of the four colors**. The moving variants
look at `(SpriteID - $185) AND #$0002` -- which gives 0 for
green-pair, 2 for yellow-pair. So:
- `$185` Green Left  : `($AA00, $0000)` from index 0 = left.
- `$186` Green Right : `($AA00, $0000)` from index 0 ... actually
   the same value -- the *direction* split is in the stationary
   Init's `AND #$0001` test (bit-0 picks left/right).

Following the chain back: the bit-0 check at the stationary Init's
`AND $00` compare detects "is this the right-going variant"; if so,
arms the high bit at `$16,x` which the Main reads as "flip the
velocity direction on the first tick." So:
- `$185` (bit0=1): right -- arms flip -> moves negative X (left visually but right on rail).
- `$186` (bit0=0): left -- no flip -> moves positive X (right visually).
- `$187` (bit0=1): same logic for yellow.
- `$188` (bit0=0): same for yellow.

This explains the apparent label-mismatch (the spreadsheet says
"$185 moves left, $186 moves right" but the actual game code makes
`$185` arm the flip-bit -- the "left/right" labels in the names
match the visual direction, while the encoded direction in the data
table is the reverse).

**Level 3 -- the color itself** is purely a render concern. The
shared OAM template register (called early in the per-frame render
phase that we didn't fully trace) reads the sprite-ID and picks a
palette-row offset from a small table. So $185/$186 use green
palette, $187/$188 use yellow, $189/$18A green-passive, $18B/$18C
yellow-passive, $18D red, $18E green-alt.

### 4.2 The rail-following helper `CODE_04A9FD`

The actual "follow the rail" routine is dead simple:

```
CODE_04A9FD:
    LDA $16,x : STA $6046                       ; pass current state to GSU
    TXA : STA REGISTER_SuperFX_R10              ; sprite slot
    LDA #$FFFF : STA $6040                       ; default rail-id
    LDA $75E0,x : STA $601E                      ; cached rail-id
    LDX #FXCODE_0B89E9>>16
    LDA #FXCODE_0B89E9                           ; the rail-lookup routine
    JSL !RAM_YI_Global_BeginSuperFXProcessingRt
    LDX $12
    LDA $601E : STA $75E0,x                      ; updated rail-id
    RTL
```

The actual rail-table data is in SuperFX HiROM banks (FXDATA_*).
The rail-id seeds `$75E0,x` and gets advanced/wrapped by GSU each
frame.

### 4.3 $089 horizontal red, $08A vertical pink moving platforms

The simpler "moving in a straight line between two limits" platforms.
$089 (red horizontal) sweeps `+/- $28` around its spawn X; $08A
(pink vertical) sweeps `+/- $40` around its spawn Y. They share the
direction-encoding pattern: read pixel-position bit-4 to pick the
initial X-speed sign.

```
CODE_init_red_platform:
    LDA $7182,x : AND #$0010      ; pixel-Y bit 4
    BEQ .pos
    LDA #$FF90 : BRA .store
.pos:
    LDA #$0070
.store:
    STA $75E0,x                   ; X-speed
    LDA #$0005 : STA $7540,x      ; bob timer
    LDA $70E2,x : ADC #$0028 : STA $701900,x   ; right limit
    SEC : SBC #$0050 : STA $701902,x           ; left limit
    JMP CODE_init_lava_tileset_widen
```

The lava-tileset detection bit (line 5316-5325 / `CODE_04A6D8`)
widens the collision box by 2 pixels when the level's BG1 tileset
is `$03` (lava) or `$0D` (lava+spike) -- a small concession to
make landing easier when one wrong step kills you.

Both share a single Yoshi-stand handler at `CODE_04A77C` (lines
5418-5533), which is the shared "carry Yoshi with the platform"
ride-glue used by every line-guided sprite. This handler:
1. Computes the per-frame X-delta and Y-delta (`$72C0,x`, `$72C2,x`).
2. Tests freezes / item-in-use / `$60AB` (Yoshi state).
3. Tests `$61B6` lock (am I the platform Yoshi is on?).
4. Tests `$60FC` (player input) low and high nibbles to allow Yoshi
   to walk off the platform without dragging the platform along.
5. On success: adds the delta to `EXRAM_Player_XPos` and `EXRAM_Player_YPos`,
   also updates `$611C/$611E` (frame-stable player pos snapshot).

That handler is **shared** across every platform that uses
`$61B6` for Yoshi-attachment. Hence why $095/$096 checkered blocks
re-init red-platform / pink-platform at line 4557-4564 of Bank05:
they're inheriting the §4 ride-glue.

---

## 5. Wheels / arrow rides / drift platforms

Big rotating shapes that Yoshi mounts and rides; the direction is
chosen by Yoshi's input (arrow keys etc.).

### 5.1 $051 Large Wheel

A big rideable wagon-wheel platform on BG3 (one of the few BG3-
displayed sprites that's also rideable). Init at Bank04:4782 saves
`$0073` (the horizontal scroll-direction flag, §8.8) around the BG3
register call so the value isn't clobbered:

```
init_large_wheel:
    LDA $0073 : STA $00         ; stash $0073 (scroll dir)
    JSL CODE_02813E             ; BG3 register: claims $0CB2 mutex (§8.1) AND
                                ;   nudges X by DATA_028129[$0073] = ±$0028 (§8.8)
    LDA $00 : STA $0073         ; restore $0073
    LDA $70E2,x : SBC #$0008 : STA $70E2,x  ; further X -= 8
    LDA !RAM_YI_Global_MainScreenLayers
    STA $701900,x               ; cache main-screen-layer mask
    RTL
```

Like the seesaw, the wheel is placed in pairs and self-positions from
the scroll direction; the `$0CB2` mutex keeps only one alive. See §8.8
for the full paired-platform mechanism. Both the singleton guard and
the left/right offset happen inside `CODE_02813E` here (§8.1) rather
than inline.

The wheel uses **PPU Mode-7 multiplication** (`Mode7MatrixParameterA/B`,
`PPUMultiplicationProductMid`) for Yoshi-vs-rim collision math --
not SuperFX. This is the only platform that does Mode-7 math (the
$039 rotating plank does Mode-7 too but for its own rotation, not
rider). Main reads the current wheel angle from `$78,x` (8-bit),
multiplies into a sine-of-angle, adds to Yoshi's foot Y to get the
rim contact point, then snaps Yoshi to that height.

Drift direction is from `DATA_04A33E = {$FFA0, $0060}`:
the wheel oscillates left/right around its spawn X at $60-pixel
amplitude, with a sign flip when at extremity.

Main also has a special "Player State 6" gate -- if Yoshi is doing
the special $06 state (probably the egg-aim state), it switches the
main-screen layer mask to `$0215` (subtractive layering) to enable
half-transparent wheel-spokes through Yoshi.

### 5.2 $11E/$11F Arrow Wheel

Brown ($11E) and Blue ($11F) variants of the rotating wheel ride.
The variant-encoding is one of the cleanest:

```
init_arrow_wheel:
    JSL CODE_03AE60                       ; pivot alloc
    LDA EXRAM_NorSpr_SpriteID,x
    SEC : SBC #!Define_YI_NorSpr11E_BrownArrowWheel  ; 0 or 1
    ASL : TAY
    LDA DATA_05F07B,y                     ; $0480 (brown) or $0240 (blue)
    STA $701900,x                         ; angular step per arrow press
    STZ $701902,x
    LDA #$0100 : STA $7A36,x              ; current angle
    JSR CODE_05F3B6                       ; SuperFX render setup
    RTL
```

`DATA_05F07B = $0480, $0240` -- brown wheel angular-step is twice
blue's. So brown spins more per Yoshi arrow-press; blue is the
slower wheel.

Main `main_arrow_wheel` runs a 6-stage pipeline:
1. `CODE_03AA52` (sprite-parent inherit).
2. `CODE_05F0FA` (the engine guard: tests freezes, status, etc.).
3. `CODE_05F0F3` (despawn-if-offscreen).
4. `CODE_05F1F6` (player-arrow-press detection).
5. `CODE_05F2F6` (rotation update).
6. `CODE_05F34C` (Yoshi-stand snap).
7. `CODE_05F3B6` (SuperFX OAM render).

The arrow-press logic at `CODE_05F1F6` reads `$60FC` (player input)
bits for left/right arrow; the bit selected is `AND #$01E0`
(directional-pad), then `AND #$0180` (left/right specifically), DEC,
then XOR with `EXRAM_NorSpr_XSpeed,x` to test if input matches
current direction. If it does, accelerate the wheel; if not, brake
it.

### 5.3 $120 Double-Ended Arrow Lift

A rideable platform that oscillates between two arrow-marker
endpoints. Init at Bank05:15154:

```
init_double_ended_arrow_lift:
    JSL CODE_03AE60                       ; pivot alloc
    LDA $701902,x : INC : BEQ ok          ; check $701902 != $FFFF
    INC : BEQ check_xspeed                ; -- spawn-rejection sentinel
    LDA EXRAM_NorSpr_XSpeedLo,x
    AND #$0010                            ; bit 4 of XSpeed picks initial direction
    BEQ ok
check_xspeed:
    LDA #$0020 : STA $7042,x              ; OAM flip flag
ok:
    STZ $701902,x
    LDA $7A36,x
    SEC : SBC $7A38,x
    BEQ skip
    AND #$00FF
    BEQ store_self
    LDY #$01 : STY $18,x                  ; arm "travelling" state
    BRA done
store_self:
    LDA $7A36,x : STA $7A38,x             ; align target with current
done:
    LDA #$0340 : STA $75E2,x              ; initial Y-speed
    JSR CODE_05F3A9                       ; SuperFX render setup
    RTL
```

The XSpeed-bit-4 trick: a level-data XSpeed of `$XX10` selects one
initial direction, `$XX00` the other. Combined with the $7A36 vs
$7A38 compare, the lift can have:
- Both endpoints same: it sits at the endpoint until Yoshi steps on.
- Endpoints differ by exactly 1 frame: starts on the move immediately.
- Endpoints differ by more: arms state-1 (`$18,x = 1`) -> "travelling
   toward target."

Main runs the **same 5-step pipeline** as the arrow wheel
(`CODE_05F0FA / 05F0F3 / 05F1F6 / 05F2F6 / 05F34C`), then dispatches
via `DATA_double_arrow_lift_state_ptr` (2 entries: idle and travel).
The Idle/Travel state machine handles the platform's main motion;
shared arrow-wheel pipeline handles Yoshi attachment.

The shared pipeline is the most code-reuse-rich part of §5: the same
six routines drive **three different sprite-IDs** (the two arrow
wheels and the double-ended lift). The arrow-wheel pipeline is in
effect the "Yoshi inputs direction; sprite changes velocity" pattern
abstracted out.

---

## 6. Donut + buoyant + unstable (Yoshi-weight-reactive)

Platforms that react to Yoshi standing on them: shake then fall (donut),
tilt then bob (buoyant), or break (unstable snow).

### 6.1 $117/$118 Donut Lift (small + large)

Both share Init and Main. The size selection happens in the first
two lines of Init at Bank04:9369:

```
init_donut_lift:
    LDY #$08                                          ; small: 8 px
    LDA EXRAM_NorSpr_SpriteID,x
    CMP #!Define_YI_NorSpr117_DonutLift
    BEQ .small
    LDY #$10                                          ; large: 16 px
.small:
    TYA
    STA $7BB6,x                                       ; collision width
    STA $7BB8,x                                       ; collision height (also)
    RTL
```

Both X and Y get the same byte -- the donut is a square collision
box, $08 or $10 wide.

Main has a 2-state machine via the `$76,x` byte:
- $76 = 0: normal idle. Test $60FC ground-touch + Yoshi-on-platform
   via `CODE_03D22D`. On contact: pulse `$7542,x = $0004` (bob-tick)
   and start shake animation by altering `$70E2,x` low bit.
- $76 != 0: gone-state. `JML CODE_03A31E` to despawn.

The transition: after $50 frames of contact (`$7A96,x == $40`), arm
$7542 (the bob timer). When Yoshi keeps standing on it past the
shake (frames $40..$00), the donut tries to advance the state
counter `$76,x`. The state-advance step also rewrites 4 Map16 tiles
beneath the donut from `DATA_04CB5E` via the `change_map16` engine
helper -- this makes the donut visually "fall through the platform
surface" by changing the tile graphics. The 4 tiles' coords come
from `DATA_04CB68` (X-offsets `{$0000, $0010, $FFF0, $0010}`) and
`DATA_04CB72` (Y-offsets `{$0000, $0000, $0010, $0000}`); the actual
new tile-IDs are `{$7502, $7500, $7501, $3DAA, $3DAB}` from
`DATA_04CB5E`.

The size variant ($118 large) uses the same offset table but
indexes `DATA_04CB5A,y` (= `{$0001, $0004}`) -- so small donuts
rewrite 1 tile (just the centre), large donuts rewrite 4 tiles.

### 6.2 $116 Buoyant Round Platform (water)

Floats on water surface. Init at Bank04:6405 just adjusts X/Y up by
8 each (so the platform centre is on the water-line, not embedded
below it), then sets `EXRAM_NorSpr_YSpeedLo,x = $0080` (the resting
bobbing speed) and clears `$7400,x`.

Main runs:
1. `CODE_03AA52` (parent-inherit if attached).
2. `CODE_03AF23` (gravity).
3. `CODE_04AEDF` with `Y = $04` (the seesaw tilt helper, see §8.3 --
   the buoyant platform uses the same tilt machinery as the seesaw,
   it just has different threshold limits).
4. Per-frame buoyancy check: `+0x200 limit` test, then 4-frame stall
   for stability.
5. `CODE_04AF4D` pivot transform (§8.4) to apply tilt to Yoshi's
   foot position.
6. SuperFX bob render via `FXDATA_550000+$2060` (the round-platform
   shape template).

The bob amplitude is from `DATA_04AFBC = {$FE00, $0200}` -- a
slight up-down oscillation while at rest. When Yoshi steps on, the
amplitude *grows* (the platform sinks more under weight), which
feeds back to the gravity-decay term.

Key trick: the seesaw and the buoyant platform **share the tilt
helper** but with different sprite-ID-keyed branches. `CODE_04AEDF`
at line 6411-6414 has a `CMP #$03D` check that does extra "large
seesaw mirror-the-tilt-state" logic only for $03D; the buoyant
platform skips that branch and just clamps.

### 6.3 $195/$196 Unstable Snow Platform

Snow platforms that break/tilt when Yoshi stands on them. The two
variants differ in **how big a pivot they need**:

- `$195` (small) uses `CODE_03AE60` (small-pivot alloc, 4-byte) for
  its rotation pivot.
- `$196` (large) uses `CODE_03ADFE` (large-pivot alloc, holds a
  bigger SuperFX OAM template + more pivot bytes).

Init for both:
```
STZ $7400,x
LDA $70E2,x : STA $18,x : STA $7B56,x : STA $7A36,x
LDA $7182,x : STA $7A38,x          ; cache Y rest pos
ADC #$0010 : STA $76,x              ; arm 16-px ground sample
LDA #$0018 / #$0028 : STA $7BB6,x   ; collision width: $18 small, $28 large
STZ / LDA #$FFF0 : STA $7BB8,x      ; height: 0 (small), -16 (large drops down)
STZ $701900,x                       ; "fall" flag
JSL CODE_03AE60 / CODE_03ADFE       ; pivot alloc (variant-specific)
BCC despawn                         ; alloc-fail
JSR CODE_0C878D / 0C88A2            ; SuperFX OAM register (size-keyed)
RTL
```

Main is dispatched via a tilt-then-fall pipeline. Both use:
- `FXCODE_099D9D` -- SuperFX terrain probe (does the platform hit
   solid ground from above?).
- `FXCODE_099C0D` -- SuperFX player-on-tilted-platform Y-snap.

The break sequence: when `$701900,x` (the "fall" flag) is non-zero,
each frame uses `$61C0` as a 4-step countdown that picks a tile
offset from `DATA_0C86B5 = {$0010, $0000, $FFF0, $FFE0}` (small) or
the corresponding wider table (large) and rewrites the Map16 tile
via `change_map16` -- so the platform "shatters" one tile at a time
over four frames. The shake/tilt before the break is via
`FXCODE_099F21` (which does a small rotation-add) -- the same shake
math used by the donut lift.

---

## 7. Special rides / one-of-a-kind

Eight platforms that don't fit any other category -- each has its
own unique mechanic.

### 7.1 $01A Ski-Lift Platform

A rideable platform that follows a cable defined per-level. Init at
Bank04:967 is a stub -- the actual setup happens in the chained
$01D init below.

The ski-lift reads its cable behaviour from a level-header byte at
`$700006,x` (where `x` is taken from `$701902,x`, which the Init
seeds with the cable-segment index). Cable behaviour table:
- `DATA_048693 = {$0080, $FF80}` -- segment-speed pair (forward/reverse).
- `DATA_048697` (16 words) -- segment-path lookup (relative tile
  coords for each segment-bit pattern).
- `DATA_0486B7` (18 words) -- additional segment-path lookup for
  acceleration / turn-points.
- `DATA_0486DB` (22 words) -- segment-Y offsets.

Main reads two bytes per frame: a behaviour byte (segment-id) and a
delta byte (segment-position within the segment). The lift moves
along the cable using these to interpolate.

This is the ONLY platform that follows a level-author-defined
*per-cable* path; everything else in the family has hardcoded
motion patterns or sprite-data-driven motion. The cable bytes for
ski-lift levels are pre-baked into the level data.

### 7.2 $01D Dr. Freezegood on Ski-Lift

Init at Bank04:936 -- the "rider on a lift" combiner. It spawns a
**fresh** sprite of ID $01C (the rider, Dr. Freezegood himself),
captures its slot index in `$7A38,x`, and stores the lift's slot
(`X` = current) into the rider's `EXRAM_NorSpr_GenericTable7019D6,y`.
Then falls through to `CODE_init_ski_lift` (the $01A init).

So $01D = ($01A lift) + ($01C rider) bundled into one slot's worth
of script. The rider's own Init handles its idle pose and the
"floating around the lift" animation; the lift's Main handles cable-
following. Main is shared with $01A -- the same routine handles both
the riderless and ridden lift cases.

### 7.3 $052 Balloon Platform

An inflated balloon Yoshi mounts that shrinks over time. Init at
Bank05:6876:

```
init_balloon:
    LDA $70E2,x : BIT #$0010
    BEQ .first_spawn
    AND #$FFE0 : STA $701902,x        ; cache rest Y
    LDA #$00FF : STA $74A2,x           ; full inflation
    LDA #$0060 : STA $6FA0,x           ; OAM size
    LDA #$4000 : STA $6FA2,x           ; OAM priority
    LDA #$0002 : STA $7040,x           ; flags
    STZ $7542,x : INC $76,x
    LDY !RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagLo
    BNE .skip
    INC !RAM_YI_Level_NorSpr_BalloonGeneratorActiveFlagLo
.skip: RTL

.first_spawn:
    LDY $0FEB                             ; first-spawn slot guard
    BNE .reuse
    JSL CODE_03AE60                       ; pivot alloc
    INC $0FEB
    LDA $7722,x : STA $0FE9               ; cache pivot id
    BRA .common
.reuse:
    LDA $0FE9 : STA $7722,x               ; reuse cached pivot
.common:
    INC $0FED                             ; per-level balloon count
    ... random anim init from $10 (RNG) ...
    LDA #FXDATA_550000+$0041 : SuperFX OAM register
    RTL
```

The `$0FEB`/`$0FE9`/`$0FED` global trio is interesting: this is a
**generator**, not just a sprite. A level's balloon-platform spawn
sites are limited (only one inflated at a time), and the spawn-
generator at `$70E2` bit 4 controls "first balloon" vs "respawned
balloon." When Yoshi pops one (the shrink completes), the generator
spawns a new one elsewhere.

Main has a 2-state ptr (via the initial `LDY $76,x : BEQ`):
- $76 = 0: floating around. Main does Yoshi-stand check and shrink
   timer.
- $76 != 0: scheduled-to-pop. `CODE_05B52B` checks Yoshi-distance
   ($7680 + $40 < $180 = on-screen and below) and tries to spawn a
   new balloon at Yoshi's position when timer expires.

The shrink-and-pop happens in the `CODE_05B565`-`CODE_05B6B0`
pipeline. The balloon's render uses `FXDATA_550000+$0041` (a
SuperFX shape template) which the `$7A36,x` register modulates --
the SuperFX scales the balloon by a multiplier each frame, giving
the visual shrink.

### 7.4 $094 Expanding Block

An "elastic" platform that expands when Yoshi steps on it. Init at
Bank05:3658:

```
init_expansion_block:
    JSL CODE_03AE60                ; pivot alloc
    LDA $7182,x : STA $78,x        ; cache rest Y
    LDA #$0100 : STA $7A36,x        ; scale = 1.0 (compact)
    STZ $7400,x
    JSR CODE_059BA7                ; SuperFX OAM register (FXCODE_0882FA stamp)
    RTL
```

Main runs the 4-state ptr at `DATA_expansion_block_state_ptr`
(Bank05:3998):
- State 0: idle / collapsed.
- State 1 (`CODE_059BE7`): expanding -- ticks $7A36 toward $0200 (= 2.0 scale).
- State 2 (`CODE_059C15`): fully expanded -- waits for Yoshi to leave or expiry timer.
- State 3 (`CODE_059C42`): contracting -- ticks $7A36 toward $0100 (= 1.0 scale), shrinks back.

The states cycle: 0 -> 1 -> 2 -> 3 -> 0. The state advances are
triggered by Yoshi-on-platform (state 0 -> 1), expiry timer (state
2 -> 3), and contraction-complete (state 3 -> 0).

The `Y-snap` uses the shared helper `CODE_059C6F` (Bank05:4151)
which is called at the bottom of every state -- this routine is
this family's pivot-Yoshi-bind, similar to `CODE_04AF4D` but
specialised for the expanding-rectangle shape.

A unique feature: state transitions play `!Define_YI_SoundID15_Growth`
(a sound effect named after this very sprite's mechanic) when the
state changes.

### 7.5 $09A Green Swinging Platform (flatbed ferry)

A rope-arc green platform that swings like a pendulum. Init at
Bank0E:268:

```
init_flatbed_ferry_green:
    STZ $701900,x                    ; angle = 0
    LDA #$C000 : STA $701902,x       ; angular velocity (negative -- swings left first)
    STZ $7400,x
    RTL
```

Main is one of the more SuperFX-heavy in the family -- it computes
three rope-segments + the platform body each frame. The platform
visual is 3 OAM "rope" tiles connecting the platform body to its
anchor at the level's top.

The angle math uses `FXCODE_0B8595` (cosine) twice per frame: once
on `$701900,x` (current angle) to get the platform's X displacement
relative to anchor, once on `$701902,x` (angular velocity) to get
the per-frame X-step. The render loop (Bank0E:320-356) walks the 3
rope segments adding sub-displacements derived from the cosine of
fractional angles -- a classic rope-pendulum visualisation.

When Yoshi steps on, the swing slows (the angle stops being driven)
and Yoshi rides the swing direction. When Yoshi steps off, the swing
resumes/re-aims.

### 7.6 $0FF Poochy (rideable dog)

A rideable dog that lets Yoshi cross lava/spikes safely. Init at
Bank07:2826 is just a once-per-level guard:

```
init_poochy:
    LDA !RAM_YI_Level_NorSpr_PoochyExistsFlagLo
    BEQ .first
    JML CODE_03A31E                   ; already a Poochy -- despawn
.first:
    INC !RAM_YI_Level_NorSpr_PoochyExistsFlagLo
    RTL
```

A **single-instance** guarantee -- only one Poochy per level. The
flag is cleared on level exit by the gamemode dispatcher.

Main (Bank07:2846, ~1200 lines) is one of the largest sprite Mains
in the game. It splits into:
1. `CODE_03AF23` (engine gravity).
2. `CODE_03A5B7` (sprite-transfer-item to player -- in case Yoshi
   was carrying anything).
3. Y-overflow check (Y >= $0800 -> despawn).
4. Five JSR'd helpers (`CODE_079D3D` (path follow), `CODE_079EA0`
   (anim), `CODE_079B88` (sound), `CODE_079C71` (collision),
   `CODE_079CBC` (rider physics)).
5. Main state-table dispatch via `DATA_poochy_state_ptr` (3 entries:
   idle/walk, bouncing, unused).

Then a deeper sub-state machine: `DATA_poochy_active_substate_ptr`
(6 entries) handles the various Yoshi-mounted modes (walking,
jumping, standing).

Poochy doesn't follow a SuperFX rail; instead it does its own
ground-probe physics via the engine helper `CODE_03A2F8` and per-
frame X-step (~$0100/frame = 1 px). The "Yoshi rides on top"
attachment is via a custom offset chain that puts Yoshi's pos at
Poochy's `$7C16,x + $7CD8,x - $X` (where X is the rider's foot-
offset for the current anim frame). The walk anim cycle is
`DATA_079670` (3 frames).

### 7.7 $1B4 Mini-Battle Checkered Platform

The bouncy platforms from the "Watch out below" mini-battle. Init
at Bank11:3375 is mini-battle-specific: it pulls per-slot X/Y from
parallel data tables indexed by the per-room counter `$10FE`:

```
LDY $10FE
LDA DATA_11A0B2,y : STA $70E2,x        ; X-coord
LDA DATA_11A0CA,y : STA $7182,x        ; Y-coord
TXA : STA $1100,y                       ; cache OAM index for the room's tracker
LDA $113C : BEQ .right                  ; left/right speed flag
LDA DATA_11A0E2,y
.right:
STA EXRAM_NorSpr_XSpeedLo,x             ; (always $0080 or $FF80)
INC $10FE : INC $10FE
RTL
```

The platforms are arranged in two horizontal rows of 4 each;
`DATA_11A0B2` gives X-coords ($10/$D8/$10/$D0/$28/$58/$88/$B8 = 8
positions), `DATA_11A0CA` gives Y-coords ($90/$73/$33/$B3 = 4 Y-
levels). The mini-battle plays out with 8 platforms bouncing left
and right between $10-$50 (top row) and $90-$D0 (bottom row).

Main has the simple bounce logic:
```
if X >= $80 (right half):
    if X >= $D0: clamp to $D0, flip XSpeed
    elif X < $90: clamp to $90, zero deltaX, flip XSpeed
else (left half):
    if X >= $50: clamp to $50, flip XSpeed
    elif X < $10: clamp to $10, zero deltaX, flip XSpeed
```

The platforms are *fully* defined by the data tables -- there's no
SuperFX, no shared pipeline. This makes $1B4 the simplest platform
in the family code-wise.

### 7.8 $03E Thin Platform

The narrow horizontal platforms that bend/tilt under Yoshi's weight
using SuperFX-assisted physics. The Init/Main live in their own
ROUTINE file (`yi/Routines/ROUTINE_YI_NorSpr03E_ThinPlatform.asm`),
emitted at $00:878A (V1.0) or $0F94D6 (V1.1) via the
`%ROUTINE_YI_NorSpr03E_ThinPlatform(...)` macro.

The platform has **8 sample-Y points** (the platform's vertical
deflection at 8 evenly-spaced points along its length), stored as:
- 4 bytes in `$7A36,x..$7A39,x` (samples 0-3).
- 4 bytes in `$701900,x..$701903,x` (samples 4-7, EXRAM).

Init is just `STZ $7400,x` -- the 8 sample values start at their
level-data-defined initial values (the platform's "neutral shape").

Main has a two-phase structure:
- **Phase 1** (lines $878E-$87FA): mirror the 8 sample-Y values
   into OAM scratch ($6002, $600A, $6012, $601A, $6022, $602A,
   $6032, $603A) so the platform's per-tile OAM Y-offsets reflect
   the current shape. Also propagate the player Y-offset stored in
   `$78,x` (the "Yoshi-on-platform Y-anchor" cached from previous frame).
- **Phase 2** (lines $880B-$899F): pack the 8 samples into SuperFX
   scratch ($6000, $6002, ..., $600E) AND direct-page ($00, $02, ..., $0E),
   set up GSU registers, fire `FXCODE_0B860A` (the deflection
   physics routine), then either:
   - Yoshi on + falling: `CODE_thin_platform_bend_down` -- bias each
     sample toward (sample + SuperFX-target)/2.
   - Yoshi on + not falling: `CODE_thin_platform_settle` -- same math
     without the downward bias.
   - Yoshi off: `CODE_thin_platform_relax_to_zero` -- each sample
     gets max($08, sample/8) subtracted, slowly returning to neutral.

The phase 2 writeback (lines $899F+) copies the updated 8 DP bytes
back into the slot's per-sprite state, using SEP #$20 to do byte
writes (the values are bytes; only the in-memory representation is
words).

**`FXCODE_0B860A`** is the unique-to-$03E SuperFX routine that
computes per-sample deflection targets from Yoshi's X-position
along the platform, Y-position above, and X/Y velocity. It receives
the 8 current samples ($6000-$600E), player position
($611C/$611E/$6112/$6122), player Y-velocity ($60AA), and the
platform's anchor X ($70E2,x). It returns updated targets in
$6000-$600E and a contact flag in `REGISTER_SuperFX_R1`.

The skinny platform is the **only** sprite in this family that uses
per-sample physics; everything else uses pivot-rotation or
straight-line motion.

---

## 8. Shared infrastructure

The platform family uses a handful of shared helper routines that
multiple sprites call into. Worth documenting because the same
helper-name shows up in nearly every Init/Main in the family.

### 8.1 `CODE_02813E` -- BG3 sprite-registration (Bank02:171)

Called by Init of every platform that wants to use the level's BG3
layer for its body. Specifically: `$039`, `$050`, `$051`. Behaviour:

```
CODE_02813E:
    JSR CODE_028183             ; the actual guard:
                                ;     LDA $0CB2 : BEQ ok
                                ;     PLA : JML CODE_03A31E    ; -- despawn
                                ; ok: INC $0CB2 : RTS
    STZ !RAM_YI_Level_LevelHeaderBG3TilesetLo
    PHB : PHK : PLB             ; DBR = my bank
    LDY $0073                   ; scroll direction (0 right, 2 left) -- see §8.8
    LDA $70E2,x
    ADC DATA_028129,y           ; DATA_028129 {$0028,$FFD8}: nudge X toward entry edge
    STA $70E2,x
    ORA #$0008 : STA $7E42
    LDA #$0104 : STA $0CB8      ; lock BG3 mode
    STZ $7E40 : STZ $0CB4
    ; ... palette block load from DATA_falling_wall_palette_pool ...
    PLB
    RTL
```

The `$0CB2` global is the **BG3-active flag**. A level can have at
most one BG3 sprite alive at a time (because the BG3 tilemap region
is shared). When a $039/$050/$051 spawns and `$0CB2` is non-zero
(another BG3 sprite is alive), the spawn is rejected and the slot
is freed via `CODE_03A31E`.

The $03D Large Seesaw has a similar but **self-managed** guard
because it doesn't actually use a BG3 sprite tilemap (it draws via
OAM); it just respects the same `$0CB2` flag to avoid stepping on
the other BG3 sprites.

### 8.2 `CODE_04A280` -- the rope-arc / single-point pendulum helper

Called by `$050`, `$05E`, `$05F`, $03D, $116, $07F, ... -- any
platform that's a single-point pivot. Signature: `Y = clip-X-amplitude,
A = clip-Y-amplitude`. Returns C = "Yoshi is in contact with the
platform body" (carry-clear = contact, carry-set = no contact).

Internally:
1. Multiplies the input by the `$7019D9` slot byte (a per-sprite
   "scale" multiplier).
2. Computes platform-position via `FXCODE_0B8595` (cosine) with
   `R6 = passed multiplier, R1 = $7019D9` (the slot's scale).
3. Tests the resulting X+Y delta against the player's foot pos
   ($60AA) and X-pos.
4. On contact: incs `$61B4` (the engine's "Yoshi is on a sprite"
   flag), zeros Yoshi's Y-velocity ($60AA).
5. Returns C = contact-or-not.

This routine is the **single point of contact** for the seesaw / log
seesaw / brown board / grey board / buoyant platform with the player
collision system. They all funnel their hit-detect through here.

### 8.3 `CODE_04AEDF` -- shared tilt-physics (Bank04:6371)

Called by every seesaw-shaped platform: `$03D` (large seesaw), `$07F`
(log seesaw), `$116` (buoyant). It's the "weighted tilt accumulator"
that takes a per-slot tilt limit (from `DATA_04AED7`, four limit-pairs
keyed by `Y`) and applies Yoshi's weight contribution to the per-
slot tilt value at `$701901,x`.

```
CODE_04AEDF:                    ; input: Y = sprite-class
    LDA freeze_flags ; ...
    BNE skip                    ; skip if frozen
    LDA $7A38,x : STA $00       ; current angular velocity
    CLC : ADC $701901,x         ; add to current angle
    BPL .positive
    CMP DATA_04AED7,y           ; vs lower limit
    BPL .within  ; -- below limit
    LDA DATA_04AED7,y           ; clamp to lower
    BRA .commit
.positive:
    CMP DATA_04AED7+$02,y       ; vs upper limit
    BMI .within  ; -- within
    LDA DATA_04AED7+$02,y       ; clamp to upper
.commit:
    PHA
    ; -- Special case for $03D large seesaw only:
    LDA EXRAM_NorSpr_SpriteID,x
    CMP #!Define_YI_NorSpr03D_LargeSeesaw
    BNE .normal
    ; ... flip the tilt mirror for the "the other side rebounds" effect ...
.normal:
    PLA
.within:
    STA $7A38,x
    RTS
```

`DATA_04AED7 = {$C000, $4001, $E000, $2001}` is two pairs of
clip-limits:
- Pair 0 (`Y = $00`): `{$C000, $4001}` -- narrow, used by log seesaw $07F.
- Pair 2 (`Y = $04`): `{$E000, $2001}` -- wider, used by buoyant $116 and
  large seesaw $03D.

### 8.4 `CODE_04AF4D` -- pivot-Yoshi-bind transform (Bank04:6429)

The "given a pivot angle and Yoshi's foot pos, compute the rotated
foot pos" SuperFX-driven helper. Sets up:
- `REGISTER_SuperFX_R7` (= sin component from `DATA_04AF3D`).
- `REGISTER_SuperFX_R8` (= player Y-relative-to-pivot).
- `REGISTER_SuperFX_R12/R13` (LOOP region for the FXCODE_0B8500 entry).
- `REGISTER_SuperFX_R9` (= `$7A39,x ASL` = tilt angle * 2 = lookup
  index).
- `REGISTER_SuperFX_R2` (= sin LUT at `FXDATA_0BBA12 + index`).

Then JSL's `FXCODE_0B8500`. That routine writes back rotated X/Y
into `$603C` and `$603E` (SuperFX scratch), and a "contact" byte
into `$603E` (zero = no contact, nonzero = contact). The platform's
Main reads `$603E` to know whether to apply pivot motion to Yoshi.

### 8.5 `CODE_03AE60` / `CODE_03AD74` / `CODE_03ADFE` -- pivot allocation

Three flavours of pivot-slot allocation (Bank03), all returning a
4-word pivot-block index in `$7722,x`:

- **`CODE_03AE60`** -- standard 4-word pivot block. Used by most
  pivot-using platforms: `$03D`, `$05E/$05F`, `$07F`, `$116`, `$162`,
  `$180`, `$18F`, `$11E/$11F`, `$120`, `$094`, `$095/$096`, `$052`.
  Allocates from a small set of 7 pivot-slot patterns
  (`DATA_03ACF6,x`); fails if all 7 slots taken.

- **`CODE_03ADFE`** -- single-large-pivot block (one bigger pivot
  slot for sprites that need wider OAM scratch). Used only by `$196`
  (large unstable snow). Allocates the single sentinel block at
  `$7ECC = $FFFF`.

- **`CODE_03AD74`** -- *partner* pivot block. Used by sprites that
  need TWO related pivot slots (a primary + a mirrored partner).
  Used by `$162` (which spawns 2 platforms in one sprite slot), the
  `$15F/$160` pair (where the spiked-platform sprite spawns a
  partner platform from the same slot), and $01D (Dr. Freezegood
  spawns a $01C rider).

All three failure modes (`CODE_0DA58F` / `CODE_03A31E`) clean up
properly: zero out the cache, release the half-allocated state,
despawn the slot.

### 8.6 `CODE_04A78E` -- shared Yoshi-rides-platform glue (Bank04:5427)

The actual "if Yoshi is on this platform, drag him with our motion"
routine. Inputs:
- `$72C0,x` (per-frame X-delta).
- `$72C2,x` (per-frame Y-delta).
- `$61B6` (which sprite Yoshi is currently riding -- == X means yes).
- `$60AB` (Yoshi state -- negative means "alive on ground").
- `$60FC` (player input).

Behaviour:
1. If `$0B59` (cinematic flag) or `$60AB > 0` (Yoshi not on ground)
   or `$0D94` (sub-cinematic) -> skip Yoshi-stand.
2. If `$61B6 != X` (Yoshi is on a different platform) -> skip update.
3. If player input has a left/right direction AND that direction's
   XOR with platform XSpeed is negative -> let Yoshi walk off (don't
   apply X-drag).
4. Otherwise apply `$72C0` to `EXRAM_Player_XPosLo` and `$611C` (the
   frame-stable position snapshot).
5. Repeat for Y with `$72C2` / `$60FC` low-nibble (up/down).
6. Test new player-foot-vs-platform-collision-box; if outside the
   box, set `$61B6 = 0` (Yoshi has stepped off) and finish; if
   inside, snap Yoshi's Y to the platform's top.

This is used by the entire §4 line-guided family, the moving red
($089) and pink ($08A) platforms, the spiral ($18F), and via the
spiral's chained call also the rotating clusters in §1. Effectively
it's the "platforms in motion + Yoshi-on-board" shared physics.

### 8.7 SuperFX FXCODE entry points used by the family

The most-called GSU-2 routines:

| FXCODE | Role | Callers |
|---|---|---|
| `FXCODE_0B8595` | Cosine LUT (rope-arc / single-point pendulum) | $050, $03D, $07F, $116, $094, $095/$096, $09A, $0FF (via shared CODE), the rotating clusters $055/$056/$064/$15E |
| `FXCODE_0B85D0` | 4-orbit cluster rotation | $055/$056/$064/$15E (the rotating clusters) |
| `FXCODE_0B89E9` | Rail-table lookup | $185-$18E (10 variants), $18F (spiral) |
| `FXCODE_0BBCF8` | Rail-direction normalisation | $185-$18E, $18F, $180 (spinning log), $120 (double-arrow lift) |
| `FXCODE_0B8500` | Pivot-Yoshi-bind transform (sin-rotated player pos) | shared helper `CODE_04AF4D`, called by $03D, $07F, $116 |
| `FXCODE_0B86B6` | Player-Y vs slope-rebound | $116 buoyant, $03D large seesaw |
| `FXCODE_0B860A` | 8-sample physics deflection | $03E thin platform only |
| `FXCODE_088205` | OAM template register (small pivot) | $07F, $180, $096/095 (variant), $094, ... |
| `FXCODE_088295` | OAM template register (large pivot) | $095/$096 (alternate-state) |
| `FXCODE_0882FA` | OAM template register (expanding shape) | $094, $116 |
| `FXCODE_088293` | OAM template register (balloon shape) | $052 |
| `FXCODE_088678` | OAM template register (orient-2) | shared via `DATA_03AF1F` |
| `FXCODE_099D9D` | Terrain probe (does platform hit ground from above?) | $195, $196 |
| `FXCODE_099C0D` | Player-on-tilted-platform Y-snap | $195, $196 |
| `FXCODE_099F21` | Small rotation-add (shake) | $195 (small unstable snow) |
| `FXCODE_08D46A` | Continuous LOC count + DMA | $051, $05E/$05F |
| `FXCODE_08D486` | BG3 plank renderer | $05E/$05F (only) |
| `FXCODE_0AE864` | Cluster Yoshi-vs-rotating-platform contact test | $055/$056/$064/$15E only |

The platform family is the **single biggest consumer of SuperFX
helpers** in the YI sprite code -- more than the boss family per
sprite-ID. Most other sprite families lean on SuperFX for OAM
template registers only; this family also uses it for live physics
(`FXCODE_0B860A` / `FXCODE_099C0D` / `FXCODE_0AE864`).

### 8.8 `$0073` / `$0075` -- camera scroll-direction flags (the left/right-entry logic)

`$0073` is **not** per-sprite state and **not** a "spawn-table entry
index" -- it's a global byte that the per-frame camera-commit routine
`CODE_04FD28` (Bank04:14860) rewrites every frame by comparing the new
camera position against the previous frame's:

```
CODE_04FDD8:
    LDY #$00
    CMP Layer1XPosLo        ; new camera X vs. last frame's
    BPL +                   ; new >= old -> scrolling RIGHT (or still)
    LDY #$02                ; new <  old -> scrolling LEFT
+   STY $73                 ; $0073 = 0 (right) | 2 (left)
    STA Layer1XPosLo        ; commit camera X
    ...
CODE_04FDFB:                ; identical for vertical:
    ...
    STY $75                 ; $0075 = 0 (down)  | 2 (up)
```

So **`$0073` = horizontal scroll direction (0 right, 2 left)** and
**`$0075` = vertical scroll direction (0 down, 2 up)**. Two consumers
read them, both keyed to "which screen edge is the *leading* edge":

1. **The new-sprite spawn probe** `CODE_check_newspr_xoffset`
   (Bank03:2040) -- `LDX $0073` / `LDX $0075` index `DATA_03958E`
   `{$0120, $FFD0}` (X-edge) and `DATA_039592` `{$0110, $FFE0}`
   (Y-edge) so the chip-side hit-test probes the leading edge: new
   offscreen-list sprites are pulled in from the right edge when
   scrolling right, the left edge when scrolling left.
2. **The BG3 platform Inits** nudge their own X toward that edge: the
   seesaw `$03D` adds `#$0078 / #$FF88` inline (`±$0078`), the wheel
   `$051` / board `$050` / plank `$039` add `DATA_028129 {$0028,$FFD8}`
   (`±$0028`) inside `CODE_02813E` (§8.1). Both index that pair by
   `$0073`. The bulk level-load spawn `CODE_check_newspr_screen`
   (Bank03:1992) forces `STZ $0073` (= the right/forward case) before
   its scan.

These BG3-platform Inits run **synchronously inside the spawn scan**
(`CODE_init_special_sprite`, Bank03:2294, dispatches them via the
`DATA_special_sprite_inits` table), so `$0073` still holds the live
scroll direction when they read it.

**Why `$03D` / `$051` come in pairs.** This is the emergent behaviour,
not an explicit pairing -- the two copies never reference each other.
A designer places two copies of the platform; the engine then:

- **Singleton via `$0CB2`** (§8.1) -- the first copy to cross the
  leading edge claims the BG3 slot; the second copy, when it later
  scrolls into the spawn window, finds `$0CB2 != 0` and immediately
  despawns itself (`JML CODE_03A31E`). When the active copy scrolls
  off-screen it releases the slot (`STZ $0CB2`, e.g. Bank04:6904) so a
  later re-approach can re-spawn.
- **Self-positioning via `$0073`** -- the surviving copy offsets its X
  toward the edge it scrolled in from.

The net effect: regardless of which side Yoshi approaches from, the
copy anchored for that approach wins the mutex and self-aligns, and
the redundant copy silently suppresses itself -- "the other one is
screen-limited and doesn't show up." No sprite ever reads the other's
slot or position.

---

## 9. Yoshi-mount mechanics

The various ways the family wires "Yoshi is now standing on me":

**(A) Standard `$61B6` lock + `$61B4` increment.** The default. Used
by every platform that uses `CODE_04A78E` (shared rider-ride glue),
which is the bulk of §4, §1, §2's seesaws, §6's donut/buoyant. The
contract: the platform's Main reads `$61B6` and if it equals X (this
slot), the per-frame `$72C0`/`$72C2` X/Y delta is applied to Yoshi's
position. `$61B4` is the engine's "Yoshi is on a sprite" flag --
incremented by every platform that locks (so the engine knows to
keep Yoshi above the sprite surface).

**(B) Pivot-transform Yoshi position.** Used by the tilting platforms
(`$03D`, `$07F`, `$116`) via `CODE_04AF4D`. The platform doesn't
just drag Yoshi -- it computes a rotated foot-pos so Yoshi tips
with the platform. Yoshi's apparent X stays roughly constant; Y
shifts up/down as the platform rotates. This creates the visual
illusion of "Yoshi standing on a tilted plank."

**(C) Custom carry-offset chain.** Used by Poochy ($0FF). The
attachment is via an explicit X/Y offset per anim frame, not the
`$61B6` lock. So Poochy can run, jump, and bob and Yoshi follows
with frame-accurate offset.

**(D) Yoshi-on-spawn (no per-frame update).** Used by the rotating
clusters $055/$056/$064/$15E. The 4 sub-platforms are checked
individually via `CODE_04C6B3` (one call per sub-platform). When
Yoshi lands on one, the cluster locks `$61B6 = X` and remembers WHICH
sub-platform Yoshi is on via `$18,x` (= 0/1/2/3). On subsequent
frames the cluster reads `$18,x` to find the right sub-platform and
mirrors only THAT platform's motion to Yoshi.

**(E) Sprite-spawned-and-Yoshi-rides.** Used by Dr. Freezegood
($01D), which is `$01A` lift + `$01C` rider; the lift handles
Yoshi-stand, and the rider sprite ($01C) handles its own animation.

**(F) Shrink-and-pop.** Used by Balloon ($052). When Yoshi is on,
the balloon's animation runs the shrink sequence; when fully shrunk,
Yoshi is "released" into free-fall and the balloon is despawned.

**(G) Switch-toggled motion.** Used by $095/$096 (checkered switchable).
When Yoshi steps on, the block doesn't move *per se*; it commits
its current pose and waits for the global `! switch` flag to flip,
at which point the block re-enters its state machine and the
opposite-colored block becomes solid.

**(H) Direct-position-write.** Used by mini-battle checkered $1B4
which writes its own X-pos via inline math (lines 11A11A-11A174)
without using the shared rider-ride glue. The platforms in $1B4
don't track Yoshi specifically -- they just bounce, and the engine's
generic spawn-collide-respond loop handles the rider attachment
via the standard $61B6 mechanism.

The common factor: every sub-family uses **the same $61B6 / $61B4
engine contract** -- the difference is how each computes the
per-frame motion to apply. The platform family is really just "30
different ways to compute (deltaX, deltaY) for the rider attached
above me."

---

## 10. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` -- canonical sprite IDs and
  one-line summaries for `$01A`, `$01D`, `$039`, `$03D`, `$03E`,
  `$050`, `$051`, `$052`, `$055`, `$056`, `$05E`, `$05F`, `$064`,
  `$07F`, `$089`, `$08A`, `$094`, `$095`, `$096`, `$09A`, `$0FF`,
  `$116`, `$117`, `$118`, `$11E`, `$11F`, `$120`, `$15C`, `$15D`,
  `$15E`, `$15F`, `$160`, `$162`, `$180`, `$185`-`$18E`, `$18F`,
  `$195`, `$196`, `$1B4`.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_main` etc.) that runs every platform's `_Main`.
- `docs/mchip.md` -- the SuperFX FXCODE_0B85xx / 0B89xx / 0B8500
  family used by the platform Mains.
- `docs/levelloader.md` -- BG3 tilemap allocation (which makes
  `CODE_02813E` work).
- `docs/leveldataengine.md` -- how each platform's sprite-list
  entry gets a slot.
- `yi/Banks/Bank04.asm:14860` (`CODE_04FD28`, camera-commit) sets the
  `$0073` / `$0075` scroll-direction flags; `yi/Banks/Bank03.asm:1992`
  (`CODE_check_newspr_screen`) + `:2040` (`CODE_check_newspr_xoffset`)
  consume them when probing for new offscreen sprites. See §8.8 for
  the paired-platform behaviour these drive.
- `yi/Banks/Bank02.asm` -- `$039` rotating plank (lines 1564-1747),
  `$03D` reuses helpers from here.
- `yi/Banks/Bank04.asm` -- the bulk of the family (lines 967-9594).
  Key helpers: `CODE_02813E` proxy (Bank02:171), `CODE_04A280`
  (rope-arc, 4738), `CODE_04A78E` (shared rider, 5427),
  `CODE_04A9FD` (rail lookup, 5746), `CODE_04AEDF` (tilt physics,
  6371), `CODE_04AF4D` (pivot Yoshi bind, 6429), `CODE_04AE9D`
  (SuperFX OAM register, 6341).
- `yi/Banks/Bank05.asm` -- `$094` (3658), `$095/$096` (3986),
  `$052` (6876), `$11E/$11F` (14722), `$120` (15154).
- `yi/Banks/Bank07.asm` -- `$0FF` Poochy (2826).
- `yi/Banks/Bank0C.asm` -- `$195/$196` unstable snow (871/899).
- `yi/Banks/Bank0D.asm` -- `$15C/$15D` switch (4813), `$15F/$160`
  spiked platforms (4865), `$162` double-spike-with-switch (5265),
  `$180` spinning log (7427).
- `yi/Banks/Bank0E.asm` -- `$09A` swinging green platform (268).
- `yi/Banks/Bank11.asm` -- `$1B4` mini-battle checkered (3375).
- `yi/Routines/ROUTINE_YI_NorSpr03E_ThinPlatform.asm` -- the
  $03E thin platform (emit at $00:878A V1.0 / $0F94D6 V1.1).
- `yoshisisland-disassembly/disassembly/bank04.asm` -- Raidenthequick
  descriptive labels (`init_donut_lift`, `init_seesaw`,
  `init_arrow_wheel`, `init_line_guided_platform`,
  `init_skinny_platform`, `init_balloon`, `init_expansion_block`,
  `init_checkered_block`, `init_buoyant_round_platform`,
  `init_unbalanced_snowy_platform`, `init_flatbed_ferry_green`,
  `init_poochy`). Verified label-by-label.
- `ys_floor.asm` / `ys_lift.asm` / `ys_swing.asm` / `ys_pl_*.asm`
  -- parallel asm for the platform family. Shares the multi-state
  + per-frame-tilt-physics pattern with our `$03D` / `$07F` /
  `$116` triad.

---

## 11. Open questions

The platform family has the most-varied behaviour in YI, so several
specifics couldn't be pinned down without runtime verification:

- **Rotating cluster $19 byte sourcing (resolved; visual sign still
  open).** For the auto variants ($064/$15E), Init derives the spin
  direction from spawn position: `LDA $70E2,x : AND #$0010 : LSR x4`
  isolates **bit 4 of the platform's X-position** (`$70E2,x` is the
  X coord) and indexes `DATA_04C242` (`db $80,$7F`), storing `$80`
  (bit clear) or `$7F` (bit set) into `$19,x` (Bank04.asm:8369-8380).
  Each frame the shared Main sign-extends and doubles that byte and
  adds it to the rotation-rate accumulator `$78,x`
  (`CODE_04C60D`, Bank04.asm:8798-8809): `$7F` -> `+$00FE`/frame,
  `$80` -> `-$0100`/frame. So the **sign** of `$19` is the direction
  and the choice is fully determined by spawn X bit-4 -- placing the
  cluster one 16-px column over flips it. That bit-4 is **genuine
  position, not a packed flag**: the level sprite record stores X/Y as
  whole-tile coords and spawn expands them `tile * 16` (`ASL x4`), so
  pixel bits 0-3 are always 0 and bit-4 is the tile-coordinate LSB
  (full derivation + the engine-wide catalog of sprites that do this
  in `docs/spritestateengine.md` §10.2 Pattern A). The 127-vs-128
  magnitude gap is incidental; only the sign matters. (The manual
  variants $055/$056 skip this init and rotate from Yoshi's push.)
  **Still open:** which sign (`$80` vs `$7F`) is *visually* clockwise
  -- needs a runtime/offline-render check.

- **$185 vs $186 visual direction labelling.** The Init's
  bit-direction encoding (§4.1) suggests $185 arms the flip-bit (so
  it visually moves *left* on the rail), but the constant name says
  "Left." The "Left" / "Right" in the names refers to the *visual*
  initial-direction, not the raw direction from the data table. This
  is consistent with the convention but worth a level-data sanity
  pass to confirm there isn't a per-level inversion.

- **$09A swinging platform's rope rendering.** The 3 rope segments
  in `main_flatbed_ferry_green` (Bank0E:320-356) are drawn at sub-
  displacements derived from `$701900,x + frame-counter`. **Is the
  rope visually anchored to a level-fixed point** (a top-of-screen
  hook) **or to the camera?** The code adds `$6094` / `$609C` (level
  X/Y origins) so it seems level-fixed, but the camera-tracking math
  would visually pin it. Worth a runtime check.

- **$120 Double-Ended Arrow Lift cable-direction selection.** The
  Init reads `XSpeed AND #$0010` to pick the initial direction.
  Combined with the `$701902 != $FFFF` rejection and the `$7A36 ==
  $7A38` "endpoint coincide" branch, there are 4 distinct init
  states. **The full state space and how levels pick them** needs
  level-data inspection.

- **$094 ExpandingBlock state 0 stub.** `DATA_expansion_block_state_ptr`
  index 0 points at `CODE_0580C2` (engine shared stub). The actual
  "idle" state's behaviour is in `CODE_059BE7` (= state 1) -- so
  state 0 is the **post-state-3 reset** state, NOT idle. The block
  may sit at state 0 for one frame between contraction and re-arming,
  but it's effectively a no-op. Worth confirming with a runtime
  step-through.

- **$03E thin platform sample-Y representation.** The 8 samples are
  stored as bytes (`AND #$00FF` in the phase-1 mirror), so the
  range is $00-$FF -- but a signed Y-deflection should ideally be
  $80-$7F or $80-$00. Is this **signed (-128..+127) or unsigned
  (0..255)**? The SuperFX side at `FXCODE_0B860A` may interpret it
  either way; without GSU disassembly we can't be sure. Likely
  unsigned with $80 = "rest position."

- **$0FF Poochy's `DATA_poochy_state_ptr` "unused-2" entry.** The
  3-entry table has entry 2 pointing at `CODE_079A3B` which is
  labelled "unused." There's no observed gameplay state where this
  is reached. **Is it dead code** (a leftover from development) or
  is there a hidden trigger?

- **$094 Yoshi-Y-shift "Growth" sound.** The state transition between
  contracting (state 3) and idle (state 0) plays the Growth sound
  -- but contracting *is* shrinking, not growing. **Is the sound
  effect mis-named** ("Growth" is what gets allocated for $05 in
  the sound table) or is the transition itself a growth from "fully
  shrunk" to "respawn-ready"? Likely the latter -- the sound is
  about re-appearance, not size change.

- **$01A ski-lift cable-segment $700006 mapping.** The lift reads
  `$700006 + offset_from_701902` to get its segment-id. The 16-word
  `DATA_048697` table is path-shape data; the 22-word `DATA_0486DB`
  table is Y-offset data. **How the cable's overall path is
  authored** (presumably level-data segment-by-segment) is not
  visible from the code alone. Worth a deep-dive into the level
  loader for ski-lift levels.

- **Why does the spinning log $180 not call `CODE_03AE60` like the
  log seesaw $07F?** $180 calls `CODE_03AE60` but $07F also does --
  inconsistent reading. Actually both use it; the difference is
  $07F also calls `CODE_04AE9D` (the SuperFX OAM register, FXCODE_088205)
  in Init, while $180 doesn't until the first Main tick. **Why is
  the OAM register deferred for $180?** Likely so the log animates
  with the spin-up rather than appearing at full-rotation; verify
  by stepping.

- **The §4 line-guided shared-Main pattern: is rail-id `$75E0,x` ever
  changed during runtime?** The Main updates `$75E0,x` from the GSU
  return (`$601E`), so a single rail can advance the platform along
  itself, but **does a sprite ever switch onto a different rail**
  (e.g., a Y-shaped rail)? The data tables in HiROM at
  `FXDATA_0BBA12` and similar would need disassembly to confirm.
