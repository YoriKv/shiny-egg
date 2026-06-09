# YI Lakitu + cloud-family reference

Standalone reference for the Yoshi's Island Lakitu, arrow-cloud,
winged-cloud, and small-cloud sprite families.  Companion to
`docs/spritestateengine.md`; same conventions (CurrentStatus byte values,
per-sprite ptr tables, dispatch through `handle_sprite`).

Scope: every "cloud-shaped" sprite or cloud-rider in `NormalSpriteIDs.asm`.
Counterpart projectiles ($0099 Spiny Egg / $011D wall-Lakitu projectile /
$0A2 thunder fireball) and ambient sprites used as visual sub-effects
($1F8 balloon-lift-end puff, $200 clank, $20D/$20E thunder, $1EE pop,
$1E6 bat-generator-puff) are included by reference only -- this doc
focuses on the parent cloud sprites.

Bare filename references to companion materials (Raidenthequick
disassembly, internal subsystem `.asm` filenames) are noted inline.


## 1. Family at a glance

| ID    | Name                                | Init Bank   | Main Bank   | Subfamily        |
| ----- | ----------------------------------- | ----------- | ----------- | ---------------- |
| $067  | RockRevealedHiddenWingedCloud       | Bank0F:2002 | Bank0F:2051 | hidden winged    |
| $083  | BowserFightCloud                    | Bank04:11428| Bank04:11441| specialty        |
| $0A2  | ThunderLakituFireball               | Bank0E:6326 | Bank0E:6352 | projectile       |
| $0AF  | CarMorphBubble                      | Bank03:8652 | Bank03:8838 | morph bubble     |
| $0B0  | MoleMorphBubble                     | Bank03:8653 | Bank03:8839 | morph bubble     |
| $0B1  | HelicopterMorphBubble               | Bank03:8654 | Bank03:8840 | morph bubble     |
| $0B2  | TrainMorphBubble                    | Bank03:8655 | Bank03:8841 | morph bubble     |
| $0B4  | SubmarineMorphBubble                | Bank03:8656 | Bank03:8842 | morph bubble     |
| $0B5  | HiddenWingedCloud                   | Bank03:8543 | Bank03:8557 | hidden winged    |
| $0B6  | WingedCloudWith8Coins               | Bank03:8633 | Bank03:8843 | winged cloud     |
| $0B7  | WingedCloudWithBubbled1up           | Bank03:8634 | Bank03:8844 | winged cloud     |
| $0B8  | WingedCloudWithFlower               | Bank03:8635 | Bank03:8845 | winged cloud     |
| $0B9  | WingedCloudWithPOW                  | Bank03:8687 | Bank03:8846 | winged cloud     |
| $0BA  | WingedCloudWithStairs               | Bank03:8688 | Bank03:8847 | winged cloud     |
| $0BB  | WingedCloudWithPlatform             | Bank03:8689 | Bank03:8848 | winged cloud     |
| $0BC  | WingedCloudWithBandit               | Bank03:8690 | Bank03:8849 | winged cloud     |
| $0BD  | WingedCloudWithCoin                 | Bank03:8636 | Bank03:8850 | winged cloud     |
| $0BE  | WingedCloudWith1up                  | Bank03:8673 | Bank03:8851 | winged cloud     |
| $0BF  | WingedCloudWithKey                  | Bank03:8637 | Bank03:8852 | winged cloud     |
| $0C0  | WingedCloudWith3Stars               | Bank03:8638 | Bank03:8853 | winged cloud     |
| $0C1  | WingedCloudWith5Stars               | Bank03:8639 | Bank03:8854 | winged cloud     |
| $0C2  | WingedCloudWithDoor                 | Bank03:8691 | Bank03:8855 | winged cloud     |
| $0C3  | WingedCloudWithLowerGround          | Bank03:8692 | Bank03:8856 | winged cloud     |
| $0C4  | WingedCloudWithWatermelon           | Bank03:8693 | Bank03:8857 | winged cloud     |
| $0C5  | WingedCloudWithFireWatermelon       | Bank03:8694 | Bank03:8858 | winged cloud     |
| $0C6  | WingedCloudWithIcyWatermelon        | Bank03:8695 | Bank03:8859 | winged cloud     |
| $0C7  | WingedCloudWith3LeafSunflower       | Bank03:8696 | Bank03:8860 | winged cloud     |
| $0C8  | WingedCloudWith6LeafSunflower       | Bank03:8697 | Bank03:8861 | winged cloud     |
| $0C9  | WingedCloudWithCrashGameFeature     | Bank03:8698 | Bank03:8862 | winged cloud     |
| $0CB  | WingedCloudWithCoinOrStar           | Bank03:8701 | Bank03:8863 | winged cloud     |
| $0CC  | WingedCloudWithRedSwitch            | Bank03:8640 | Bank03:8864 | winged cloud     |
| $0D9  | FishinLakitu                        | Bank0E:14527| Bank0E:14560| Lakitu rider     |
| $0EA  | VerticalCloudDrop                   | Bank06:6393 | Bank06:6445 | small cloud foe  |
| $0EB  | HorizontalCloudDrop                 | Bank06:6612 | Bank06:6662 | small cloud foe  |
| $11B  | Lakitu                              | Bank07:4826 | Bank07:4893 | Lakitu rider     |
| $11C  | LakituCloud                         | Bank0D:7881 | Bank0D:7898 | rideable cloud   |
| $11D  | SpinyEgg (Wall-Lakitu projectile)   | Bank0E:6326 | Bank0E:6399 | projectile       |
| $149  | UpArrowCloud                        | Bank07:7206 | Bank07:7290 | arrow cloud      |
| $14A  | UpRightArrowCloud                   | Bank07:7211 | Bank07:7291 | arrow cloud      |
| $14B  | RightArrowCloud                     | Bank07:7215 | Bank07:7292 | arrow cloud      |
| $14C  | DownRightArrowCloud                 | Bank07:7219 | Bank07:7293 | arrow cloud      |
| $14D  | DownArrowCloud                      | Bank07:7223 | Bank07:7294 | arrow cloud      |
| $14E  | DownLeftArrowCloud                  | Bank07:7227 | Bank07:7295 | arrow cloud      |
| $14F  | LeftArrowCloud                      | Bank07:7231 | Bank07:7296 | arrow cloud      |
| $150  | UpLeftArrowCloud                    | Bank07:7235 | Bank07:7297 | arrow cloud      |
| $151  | RotatingArrowCloud                  | Bank07:7256 | Bank07:7304 | arrow cloud      |
| $157  | WallLakitu                          | Bank07:8305 | Bank07:8357 | Lakitu emerging  |
| $166  | ThunderLakitu                       | Bank07:13264| Bank07:13306| Lakitu rider     |
| $170  | AquaLakitu                          | Bank07:12842| Bank07:12865| Lakitu rider     |

Subfamily groupings used in the rest of this doc:

- **Lakitu riders** -- $11B / $0D9 / $166 / $170 / $157.  Cloud + rider.
  All but $157 (which uses a hole-in-wall rig) ride a stand-in 2D cloud
  whose Y-velocity is independently animated; the rider sprite owns the
  AI, the cloud is just a graphical attachment.
- **Arrow clouds** -- $149-$151.  8-direction redirector + rotating one.
  No rider; clouds catch and re-launch flying eggs.
- **Winged clouds (item-pop)** -- $0B5-$0CC (excluding $0CA Big Boss Door
  which sits in the same ID block but isn't a winged cloud).  Single
  shared Init/Main body; pop dispatches per-variant payload routines.
- **Morph bubbles** -- $0AF/$0B0/$0B1/$0B2/$0B4.  Visually distinct from
  winged clouds (no wings) but share Bank03's Init/Main/cloud-register
  scaffolding and use the same per-variant pop dispatch -- they spawn the
  Yoshi-vehicle morph cinematic instead of a payload sprite.
- **Hidden winged clouds (variant family)** -- $067 / $0B5.  Position
  low-bits encode the payload variant; only revealed by specific contact
  events.
- **Rideable cloud (post-Lakitu cleanup)** -- $11C.  Spawned by stomping
  a Lakitu; doubles as the air-attached generic "carrier" used by Thunder
  Lakitu and Fishin' Lakitu as their downward escape vehicle.
- **Small cloud foes** -- $0EA / $0EB.  Tiny gust-tied cloud puffs in
  sky/cloud levels.  Drift on one axis, harm Yoshi on contact.
- **Specialty / non-categorical** -- $083 Bowser-fight cloud platform;
  $0A2/$11D Lakitu projectiles.

The Lakitu and cloud-rider material lives almost entirely in Bank07
(SNES-side enemies in late-game levels), Bank03 (winged-cloud item
dispatch), Bank0D (Lakitu Cloud), Bank0E (Fishin' Lakitu, Cloud Drop
Lakitu fireball), and Bank06 (Cloud-Drop small enemies).  See the
companion files `ys_enmy0.asm`, `ys_enmy3.asm`, `ys_enmy5.asm`,
`ys_enmy7.asm` for the alternative naming of these per-bank handler
clusters.


## 2. Lakitu rider mechanics

### 2.1 Active-flag latching

Three of the rider variants enforce singleton spawning via WRAM flags:

| Sprite        | Flag                                     | Address |
| ------------- | ---------------------------------------- | ------- |
| $11B Lakitu   | `!RAM_YI_Level_NorSpr_LakituActiveFlag`  | $0C3C   |
| $166 Thunder  | `!RAM_YI_Level_NorSpr_FireLakituActiveFlag` | $0C68 |

On Init the sprite reads the flag; if non-zero it immediately jumps to
`CODE_03A31E` (despawn slot), preventing a second instance.  Setting the
flag to 1 reserves the slot for that level's lifetime; clearing it (via
death or being carried off-screen) hands the slot back.  Inside Main, a
zeroed flag forces a hard "fall-out-of-cloud" path:

    Bank07:4948    LDA.w !RAM_YI_Level_NorSpr_LakituActiveFlagLo
                   BNE.b cruise_path
                   LDA.w #$FC00              ; Y-acceleration FC00
                   STA.w $75E0,x             ; gravity-fall mode
                   ORA.w #$0004              ; visible-fall flag
                   STA.w $7040,x

This is how a defeated Lakitu's cloud body becomes the rider-less
$11C cleanup sprite -- the rider clears the flag, the body sees the flag
go zero, switches to gravity-fall, and on completion calls
`CODE_07AA67` which spawns the $11C cloud.

$157 Wall Lakitu does NOT use the singleton flag (multiple wall holes can
be active simultaneously) and Fishin' Lakitu/Aqua Lakitu use level-wide
generator counters (`GenericTable701900` at $701900) instead.

### 2.2 Standard Lakitu ($11B) state machine

Top dispatch is `DATA_lakitu_state_ptr` -- 3 entries at `$07:A847`:

    state $00,$01 -> CODE_07A869   "cruise" (hover + scan for throw)
    state $02     -> CODE_07A8E6   "throw spiny egg"

`$16,x` selects.  Throw sub-states walk `$76,x` 0..C with the per-tick
timing in `DATA_07A8B2`:

    $0C $02 $02 $02 $02 $02 $02 $02 $02 $06 $10 $40 $20

and frame-table `DATA_07A8BF` (frame indices, walking through animation
ticks $04..$0E).  The throw arc itself uses SuperFX `FXCODE_09907C` to
compute the spiny-egg trajectory (registers R1-R6: x/y/dx/dy/multiplier)
and spawns the projectile sprite $11D ("SpinyEgg" -- the Bank07
projectile, *not* the $099 Spiny Egg which is unrelated to Lakitu).

Cruise behaviour at `CODE_07A783`:
- Each frame, snap X-velocity sign to chase the player.  When |Xvel|>$80
  the cloud also force-shifts Y toward target Y.
- Y target is the player Y minus $30 (hover above).
- $7540 / $7542 (X / Y-acceleration magnitude) snap between $10
  (accelerating toward target) and $08 (overshooting -- decelerate).
- $75E0 / $75E2 (X / Y-acceleration sign-magnitude) snap to $0200 or
  $FE00 once velocity magnitude reaches $80 (X) / $100 (Y).
- Every 8 frames spawn `!Define_YI_AmbSpr1F8` (balloon-lift-end puff)
  beneath the cloud as motion exhaust.

### 2.3 Cloud detachment / stomp

`head_bop_lakitu` (`$07:AAEC`) is the stomp handler.  On a downward stomp
(`$7682,x` positive Y-vel high byte) when the rider has health left, the
flag DOESN'T clear -- the Lakitu just bounces ($75E0 = $0200) and
animates damage.  On lethal stomp the rider sets `$7AF8` cooldown then
follows the gravity-fall branch into `CODE_07AA67`, which spawns the $11C
LakituCloud as a *separate* sprite linked through `GenericTable701976`
($701976).

So the architecture is:
- $11B is *both* the Lakitu graphic and the cloud while alive.
- $11C is a fresh sprite spawned at death, replacing the cloud half.
- The visible "Lakitu sitting on a cloud" you see at startup is one
  sprite, not two; the visible "Yoshi mounts a riderless cloud" you see
  after killing a Lakitu is a different sprite ($11C) at the same
  position.

### 2.4 Fishin' Lakitu ($0D9)

Init (`Bank0E:14527` / `init_fishin_lakitu`):
- In level `!Define_YI_LevelID_DontLookBack` a variant flag ($78=$02) is
  set.  Other levels use the default.
- Y-speed $0100 default; X-speed picked from `DATA_0EF838,y` table
  (per-direction).
- $7400 (facing), $100D/$100B/$100F (line / fish state cache) all clear.

Main has 6 top states via `DATA_0EF863`:

    state $00   CODE_0EFD11    cruise (idle pattern)
    state $01   CODE_0EFD37    swing-line-left
    state $02   CODE_0EFDC7    swing-line-right
    state $03   CODE_0EFE57    line-recovered
    state $04   CODE_0EFE7B    leave-screen
    state $05   CODE_0EFE7F    standby

The fishing line is rendered through SuperFX `FXCODE_0B95E6` (R4/R6/R8
multiplier setup at `CODE_0EF9FE`).  The bait dangling at the line's end
is *not* a separate sprite but a single-pixel OAM tile drawn from the
animation table `DATA_0EF8C8` (255-byte rolled tile stream).

When Yoshi tongues the bait, the head-bop path through `CODE_0EF98E`
swaps the rider's state to $0008 (currentstatus = "tongued") and spawns
a $11C LakituCloud at the same X/Y, then INC's its sprite-link byte and
attaches it to slot $6162.  After that, Yoshi mounts the cloud just like
he'd mount a defeated Lakitu's cloud.

`head_bop_lakitu_fishin` shares `CODE_0ECCC7` with the Bandit family --
both have the "throw rider to background" stomp animation.

### 2.5 Thunder Lakitu ($166)

4-state top dispatch `DATA_lakitu_thunder_state_ptr` (`$07:EC8B`):

    state $00  cruise            (CODE_07ECA7)
    state $01  charge            (CODE_07ED63)  -- spawn lightning ambients
    state $02  strike            (CODE_07EE47)
    state $03  recover           (CODE_07EEFF)

Init at `Bank07:13264` checks bit $0010 of `$70E2,x` (a header position
bit) to decide whether to spawn the off-screen partner Lakitu.  The
partner is placed at Layer1XPosLo + `DATA_07F0C3,y` (per-direction X
offset) and starts at LevelY - $30 (above viewport).  Both Lakitus share
the `MainScreenLayers` snapshot via `$76,x` so they participate in the
same parallax band.

Charge state (state $01) cycles `$18,x` 0..3F and every 8 frames spawns
two thunder-segment ambients: $20D (head) and $20E (tail).  $20D and
$20E use OAM tile parameters derived from `DATA_07ED4B,y` (palette
byte) and `DATA_07ED4F,y` (X offset) keyed off the facing byte.

`!Define_YI_SoundID51_ThunderLakituAttacking1` plays once per charge
animation cycle (mask `$0F` against `$18,x`).  Stomp respawn: same $11C
cloud spawn path as $11B, with an additional Y offset of +$08 to keep
the cloud out of the player's mount-detection box during the spawn
frame.

### 2.6 Aqua Lakitu ($170)

3-state main `DATA_lakitu_aqua_state_ptr` (`$07:E825`):

    state $00  cruise (sinusoidal sweep + water-tile probe)
    state $01  throw  (spawn $0099 Bullet Bill)
    state $02  pause  (re-anchor, brief stationary)

Init reads `GenericTable701900,x` -- if zero (first spawn) it initialises
to "1" or "3" based on header bit $0010, then triple-stages into state
$04.  CODE_07E842 hands cruise's first iteration off to the actual
state-$00 handler.

Cruise uses SuperFX `FXCODE_0ACE2F` (bottom-probe of the player's water
column) at `CODE_07EA77` to detect when the swim path will exit water --
on hit, X-velocity is reversed and a $1BA bubble ambient is spawned.
$0099 spawning (state $01) reads target velocity vector from
`DATA_07E8C6` / `DATA_07E8CE` and links the projectile via
`CODE_07FCB3` SuperFX subroutine.

The two-frame throw sequence at `$18,x` values $13 and $02 spawns the
charge-up ambient ($201) and bubble pop ($1BA) on key frames; each
sub-spawn plays `!Define_YI_SoundID03_Swim`.

### 2.7 Wall Lakitu ($157)

The wall variant differs structurally: no cloud (the Lakitu emerges from
a hole in a wall), so the "kill-cloud" mechanic is replaced by a
2-level nested state machine.

Top dispatch `DATA_wall_lakitu_state_ptr` (`$07:C3A7`):

    state $00  peek-and-wait   -> DATA_wall_lakitu_peek_substate_ptr (5 entries)
    state $01  launch          -> DATA_wall_lakitu_launch_substate_ptr (2 entries)

Peek substates: hide / wait / appear / aim / throw.

The "aim + throw" pair invokes SuperFX `FXCODE_09907C` (same routine the
standard Lakitu uses) to compute projectile trajectory, then spawns
sprite $11D (Spiny Egg projectile from Bank0E's needlenose-family shared
Main).  Bit $0010 of `$70E2,x` selects "peeking" vs always-active
variant (controlled by `DATA_07C2CA`).  GenericTable7019D8 caches the
death state across frames for the "kill counter dec" cleanup path.


## 3. Arrow-cloud direction-index encoding ($149-$151)

8 fixed-direction arrow clouds + 1 rotating cloud share a single Main
body (`main_arrow_cloud` at `$07:BA31`) plus a shared per-frame
arrow-redirect helper (`CODE_07BA78`).  Per-direction code paths are
collapsed by encoding the direction as a *byte-pair index* into two
parallel velocity-vector tables.

### 3.1 The two velocity tables

`DATA_07B97C` (X velocities) and `DATA_07B98C` (Y velocities), each 8
16-bit words.  Each direction's velocity pair lives at offset
`$18,x`:

```
$00  Up-Left      $FA58  $FA58    (-1448, -1448)
$02  Left         $F800  $0000    (-2048,     0)
$04  Down-Left    $FA58  $05A8    (-1448,  1448)
$06  Down         $0000  $0800    (    0,  2048)
$08  Down-Right   $05A8  $05A8    ( 1448,  1448)
$0A  Right        $0800  $0000    ( 2048,     0)
$0C  Up-Right     $05A8  $FA58    ( 1448, -1448)
$0E  Up           $0000  $FA58    (    0, -1448)
```

Note the diagonals use ~1448 = round(2048 * sin(45)).  $0800 = 2048
matches the egg's normal flight speed in YI's 8.8 fixed-point velocity
units.

### 3.2 Per-variant Init

The 8 fixed-direction Inits at `Bank07:7206..7239` each load a fixed
constant in A and fall through into `CODE_07B9CA` (the shared cloud Init
tail):

```
$149 UpArrowCloud:        LDA #$000E  ;  Up
$14A UpRightArrowCloud:   LDA #$000C  ;  Up-Right
$14B RightArrowCloud:     LDA #$000A  ;  Right
$14C DownRightArrowCloud: LDA #$0008  ;  Down-Right
$14D DownArrowCloud:      LDA #$0006  ;  Down
$14E DownLeftArrowCloud:  LDA #$0004  ;  Down-Left
$14F LeftArrowCloud:      LDA #$0002  ;  Left
$150 UpLeftArrowCloud:    LDA #$0000  ;  Up-Left
```

(Inverse of the table -- look up Up-Left at table-index 0, Up at
table-index $0E, etc.)

Shared tail at `CODE_07B9CA` writes the index to `$18,x`, seeds
`$7402,x` (frame counter), `$76,x` (frame-reset), `$7A96,x`
(frame-step timer) all to 2 ticks each, clears `$7400,x` (facing), and
mixes the spawn position's low-bits into the palette word `$7042,x`:

```
DATA_07B99C: $0000 $0002 $0004 $0008
```

`$10` (RNG-low byte) mod 4 picks the palette offset, ASL'd to word
index, ORed into the existing palette bits.  Variants spawn with
identical-looking glyphs but slightly different palette-tile selection.

### 3.3 Rotating-cloud Init at `CODE_07B9EE` ($151)

The rotating variant generates its initial direction-index dynamically:

```
Multiplicand = 3
Multiplier   = ($10 & 7) + 1     ; 1..8
ProductOrRemainderLo = $7402     ; cloud's animation start phase
DividendLo = ProductOrRemainderLo - 1
Divisor    = 3
QuotientLo, ASL -> $18,x         ; index 0..0xE in steps of 2
```

So the spawn-side `$10` byte's low-3 bits seed the initial pose, and the
hardware divide-by-3 with ASL keeps the table-index aligned to even
offsets.  Main then re-runs the divide every frame:

```
main_arrow_cloud_rotating (Bank07:7358):
  DividendLo = $7402,x
  Divisor    = 3
  ...        (NOP padding for divide latency)
  QuotientLo ASL -> $18,x
```

Animation cycles at one-third the frame rate via the divide-by-3.

### 3.4 Per-frame redirect (CODE_07BA78)

For every cloud (`main_arrow_cloud` or `main_arrow_cloud_rotating`):

1. Read `$7D36,x` (collision-target sprite slot).  Discard if -1 / 0 /
   not "alive" (CurrentStatus != $0010) / dummy.
2. Check the target's SpriteID is in [`!Define_YI_NorSpr022_FlashingEgg`,
   `!Define_YI_NorSpr02B_GreenGiantEgg` inclusive] -- so the only sprites
   that get redirected are eggs.
3. Snap the egg's position to the cloud's current X/Y, clear its
   Y-acceleration ($7542), index `$18,x` into both velocity tables, write
   the new X-velocity and Y-velocity, set the egg's life timer to
   $FFFF (long-life override), bump $77C0 (collision-bounce counter),
   restore the cloud's $X then call `CODE_039F2B` (despawn child sprite
   reset).
4. Spawn `!Define_YI_AmbSpr200` (clank ambient) at the cloud's position,
   palette/flip flags from cloud's $7042 mirrored, frame = `$18,x >> 1`
   (so the clank animation matches the redirect angle).
5. Push two sounds:
   - `!Define_YI_SoundID20_SoaringEgg` (continuous flight whoosh)
   - `DATA_arrow_cloud_clank_sound_ids[$18,x]` -- pitched clank.

Clank pitch table (8 sound IDs descending from highest to lowest):

```
DATA_arrow_cloud_clank_sound_ids:
  $2F  ClankSound8 (highest pitch -- "up" direction)
  $2E  ClankSound7
  $2D  ClankSound6
  $2C  ClankSound5
  $2B  ClankSound4
  $2A  ClankSound3
  $29  ClankSound2
  $28  ClankSound1 (lowest pitch -- "up-left" direction)
```

Indexed by `$18,x` (direction-index 0..$E, even).  So aiming an egg
"up" produces a high-pitched clank; aiming it "up-left" produces a low
clank.

### 3.5 Frame animation

`CODE_07BA62` -- shared frame ticker for both fixed-direction and
rotating Mains.  Walks `$7402,x` down with $7A96 step-delay; when $7402
underflows it reloads from `$76,x` (initialised to $0002 in shared Init).
The rotating variant overwrites `$7402,x` in its Main via the divide so
the ticker just cycles 0..2.


## 4. Winged-cloud family ($0AF-$0CC)

Round 2 covered the *variant mechanism* for $0B5 hidden winged cloud
(position low-bits encode payload).  Coverage was correct but narrow --
the same Init/Main scaffold drives 23 sibling sprites.  This section
documents the shared scaffold and full pop dispatch.

### 4.1 Three Init dispatch flavours

| Init label                 | Calls cloud-setup helper | Calls cloud-register | Sprites |
| -------------------------- | ------------------------ | -------------------- | ------- |
| `init_winged_cloud_item`   | yes (CODE_03D406)        | yes (CODE_03C236)    | $0B6 $0B7 $0B8 $0BD $0BF $0C0 $0C1 $0CC |
| `init_transform_bubble`    | no                       | yes                  | $0AF $0B0 $0B1 $0B2 $0B4 |
| `init_winged_cloud_B`      | no                       | yes                  | $0B9 $0BA $0BB $0BC $0C2 $0C3 $0C4 $0C5 $0C6 $0C7 $0C8 $0C9 |
| `init_winged_cloud_1up`    | yes                      | yes + per-axis snap  | $0BE only |
| `init_special_winged_cloud`| yes                      | no                   | $0B5 only |
| `CODE_03C1C4` (bare inline)| no                       | no                   | $0CB only |

(`CODE_03D406` is the "set up cloud SuperFX collision shape" helper.
`CODE_03C236` registers the cloud as a hittable platform for the active
sprite slot mask -- which is why most winged clouds are stompable but
$0B5 hidden one isn't.)

After the per-flavour entry, all paths converge at `CODE_03C1C4` which:
1. Reads `SpriteID - !Define_YI_NorSpr0AF_CarMorphBubble` (so $0AF maps
   to 0, $0CC to $1A; this is the pop-dispatch index).
2. Snaps X position to the nearest $20-tile lane using
   `DATA_03C0FD` (per-variant X offsets indexed by spriteId*2 + Y-bit).
3. Snaps Y position similarly with `DATA_03C138`.
4. Initialises `$7400,x` (facing) to 0, `$7402,x` (anim frame) to 2,
   `$18,x` to 3 (cloud life-phase marker).

### 4.2 Shared Main (main_winged_cloud at $03:C08C)

Used by all 24 winged-cloud / morph-bubble sprites.  Three concurrent
duties:

1. **Hidden-reveal scan** ($0B5 only path): scan the slot array for an
   alive `!Define_YI_NorSpr018_WatermelonFlame` or `!Define_YI_NorSpr006
   _WatermelonFreeze` within the cloud's hit box; if found, force
   `CODE_03B25B` (destroy-sprite-with-fanfare) on the watermelon then
   pop the cloud.  Other variants skip this (gated by the early-exit at
   `CODE_03C0CC` on `EXRAM_YI_Level_ShowHiddenItemsFlag` or no nearby
   target).
2. **Pop trigger**: dispatched via `DATA_winged_clouds_bubbles_pops`
   (per-spriteId-offset pop handler ptr).
3. **Animation**: `$7402,x` walks the OAM frame state for the cloud
   bobbing/wing-flap.

### 4.3 Pop dispatch table (DATA_winged_clouds_bubbles_pops at $03:C51A)

Indexed by `(SpriteID - $0AF) * 2`.  30 entries:

| Offset | SpriteID | Variant                            | Pop handler                  |
| ------ | -------- | ---------------------------------- | ---------------------------- |
| $00    | $0AF     | CarMorphBubble                     | CODE_pop_transform_bubble    |
| $02    | $0B0     | MoleMorphBubble                    | CODE_pop_transform_bubble    |
| $04    | $0B1     | HelicopterMorphBubble              | CODE_pop_transform_bubble    |
| $06    | $0B2     | TrainMorphBubble                   | CODE_pop_transform_bubble    |
| $08    | $0B3     | (FuzzyFart -- unused slot here)    | $0000                        |
| $0A    | $0B4     | SubmarineMorphBubble               | CODE_pop_transform_bubble    |
| $0C    | $0B5     | HiddenWingedCloud                  | $0000 (uses CODE_03B25B)     |
| $0E    | $0B6     | WingedCloudWith8Coins              | CODE_pop_8_coins             |
| $10    | $0B7     | WingedCloudWithBubbled1up          | CODE_pop_1up_bubbled         |
| $12    | $0B8     | WingedCloudWithFlower              | CODE_pop_flower              |
| $14    | $0B9     | WingedCloudWithPOW                 | CODE_pop_pow                 |
| $16    | $0BA     | WingedCloudWithStairs              | CODE_pop_stairs              |
| $18    | $0BB     | WingedCloudWithPlatform            | CODE_pop_stairs (subtype)    |
| $1A    | $0BC     | WingedCloudWithBandit              | CODE_pop_bandit              |
| $1C    | $0BD     | WingedCloudWithCoin                | CODE_pop_one_coin            |
| $1E    | $0BE     | WingedCloudWith1up                 | CODE_pop_1up                 |
| $20    | $0BF     | WingedCloudWithKey                 | CODE_pop_key                 |
| $22    | $0C0     | WingedCloudWith3Stars              | CODE_pop_3_stars             |
| $24    | $0C1     | WingedCloudWith5Stars              | CODE_pop_5_stars             |
| $26    | $0C2     | WingedCloudWithDoor                | CODE_pop_door                |
| $28    | $0C3     | WingedCloudWithLowerGround         | CODE_pop_ground_eater        |
| $2A    | $0C4     | WingedCloudWithWatermelon          | CODE_pop_watermelon          |
| $2C    | $0C5     | WingedCloudWithFireWatermelon      | CODE_pop_watermelon (fire)   |
| $2E    | $0C6     | WingedCloudWithIcyWatermelon       | CODE_pop_watermelon (ice)    |
| $30    | $0C7     | WingedCloudWith3LeafSunflower      | CODE_pop_flower_vine         |
| $32    | $0C8     | WingedCloudWith6LeafSunflower      | CODE_pop_flower_vine (6lf)   |
| $34    | $0C9     | WingedCloudWithCrashGameFeature    | $0000 (no-op in V1.0/V1.1)   |
| $36    | $0CA     | BigBossDoor (not a winged cloud)   | $0000                        |
| $38    | $0CB     | WingedCloudWithCoinOrStar          | CODE_pop_random_item         |
| $3A    | $0CC     | WingedCloudWithRedSwitch           | CODE_pop_switch              |

Two special cases:
- `CODE_pop_transform_bubble` reads `SpriteID - $0AF`, ASLs it, and uses
  the result to index `DATA_03C556` (a 6-entry table of SuperFX
  glyph pointers `FXDATA_550000 + offset`) -- so the same routine
  triggers Car, Mole, Heli, Train, or Submarine morph depending on the
  bubble's SpriteID.  The $0B3 FuzzyFart hole in the index (entry 5 ==
  $FXDATA_550000) is unused -- $0B3 has its own Init/Main and is not a
  winged cloud despite living in the ID block.
- `CODE_pop_stairs` is shared between $0BA Stairs and $0BB Platform; an
  internal subtype byte (the cloud's `$7402,x` saved by Init) selects
  which sub-variant to spawn.
- `CODE_pop_watermelon` is shared between $0C4/$0C5/$0C6; uses
  `(SpriteID - $0C4)` as an offset into the watermelon spawn-ID table to
  pick normal / fire / ice variants ($007 / $009 / $005).
- `CODE_pop_flower_vine` similarly handles 3-leaf and 6-leaf.

### 4.4 Hidden winged-cloud variant family ($0B5)

The Round 2 coverage of this remains correct; restated for completeness.

$0B5 is one sprite ID with 4 different payloads selected at Init time
by the position low-bits.  Position bit-coding (sourced from header X/Y
position byte bit-4):

```
X=0 Y=0    1UP             (-> NorSpr0BE_WingedCloudWith1up)
X=1 Y=*    Star            (-> NorSpr0C1_WingedCloudWith5Stars)
X=0 Y=1    Switch          (-> NorSpr0CC_WingedCloudWithRedSwitch)
```

(See header comment in NormalSpriteIDs.asm lines 207-210 for the
authoritative encoding.)

The cloud-pop logic at `$03:C0CC` reads the bits into a 2-bit index,
looks up `DATA_03C084` (4-entry sprite-ID table), and spawns that
prize.  Reveal trigger: cloud's Main scans every alive slot every frame;
on contact with WatermelonFlame ($018) or WatermelonFreeze ($006)
within the hit box, calls `CODE_03B25B` (despawn target + fanfare) and
then the cloud itself pops the prize.

### 4.5 Rock-revealed hidden winged cloud ($067)

$067 is the *external* hidden-winged-cloud variant -- revealed by Chomp
Rock or Snowball rolling into it (not by watermelon).  Lives in Bank0F
not Bank03 because it needs the rolling-rock collision system.

Init at `Bank0F:2002` (`init_hidden_winged_cloud_A`):
1. Read `GenericTable701900,x` -- if non-zero, this is a re-init (avoid
   double-registration).
2. Otherwise derive variant index from `$70E2,x & $10` (X bit-4) +
   `$7182,x & $10` (Y bit-4), pack into a 2-bit value, INC, store to
   `GenericTable701900`.
3. Dispatch through `DATA_0F8ED4` -- a 4-entry decoder ptr table.

Encoding:
```
X=1 Y=1    1UP             (-> NorSpr0B7_WingedCloudWithBubbled1up)
X=0 Y=0    Star            (-> NorSpr0C1_WingedCloudWith5Stars)
X=1 Y=0    Sunflower lift  (-> NorSpr0C8_WingedCloudWith6LeafSunflower)
X=0 Y=1    Flower          (-> NorSpr0B8_WingedCloudWithFlower)
```

(See header comment in NormalSpriteIDs.asm lines 123-128 for the
encoding.  Different from $0B5's table.)

Main runs SuperFX `FXCODE_099011` (proximity-test against rolling
objects).  On hit-positive `R14_GETGamePakROMAddressPtrLo` returns the
hit sprite slot; if its SpriteID is `!Define_YI_NorSpr09E_ChompRock` or
`!Define_YI_NorSpr0DC_Snowball` the reward is spawned:

```
DATA_0F8EA6:
  dw NorSpr0C1_WingedCloudWith5Stars       ; (variant 1)
  dw NorSpr0C8_WingedCloudWith6LeafSunflower; (variant 2)
  dw NorSpr0B8_WingedCloudWithFlower       ; (variant 3)
  dw NorSpr0B7_WingedCloudWithBubbled1up   ; (variant 4)
```

Non-match? Re-run FX with `FXCODE_09906B` and loop -- so even with
multiple rolling rocks the cloud only pops for the right object types.


## 5. Lakitu Cloud / rideable cloud ($11C)

The rideable cloud spawned after defeating a Lakitu (or by Yoshi
tonguing a Fishin' Lakitu's bait).

Init at `Bank0D:7881`:
```
$7A96 = $0360    ; lifetime timer (864 frames ~ 14 seconds at 60fps)
$7AF6 = $03C0    ; animation flutter timer
```

Main at `Bank0D:7898`:
- If `$74A2 = $7D38` non-zero (cloud being despawned externally): call
  `CODE_03A2F8` and bail.
- If `CPX $61B6 == X` (player's currently-mounted sprite slot matches
  this cloud's slot index): cloud is being ridden; sense joystick X/Y
  and translate via `DATA_0DBD48` (4-entry word table: $0008 $00E8
  $0010 $FFF0) into per-frame position deltas.
- If not ridden and timer $7D38 reaches zero: despawn via
  `CODE_03A2C7 / CODE_03A31E`.
- When ridden, clamp X to within $0008..$00F0 horizontally and Y to
  $0030..$00B0; pressing the directional stick within those bounds moves
  the cloud accordingly.
- When auto-scroll is active ($0C1C set) and ridden, the cloud's
  X-velocity rubber-bands to match the camera scroll velocity ($7E28)
  so the cloud doesn't drift relative to the moving viewport.

The auto-scroll handoff is non-obvious: the cloud doesn't just lock to
the camera, it locks to the *scroll delta* -- so player joystick input
adds to scroll velocity rather than replacing it.

Stomp: cloud has no head-bop slot; cannot be killed by stomp.  Cloud
auto-despawns on lifetime expiry or dismount.

The "1F8 puff exhaust" ambient is spawned every 8 frames (via
`$7A98,x` countdown) at a random offset from the cloud's bottom -- this
is the visible drift trail.


## 6. Specialty cloud sprites

### 6.1 $083 Bowser-fight Cloud platform

Used only in the final Bowser fight.  Init at `Bank04:11428`, Main at
`Bank04:11441`.  Init reads a 4-entry speed table:

```
DATA_04DB23:
  $0030 $0040 $0050 $0060
```

Two RNG-low bits pick the speed.  $74A1 (priority) is set to 2 so the
cloud renders behind foreground but in front of background.  Main is
mostly a position-clamp + drift loop -- there's no AI to speak of, just
a moving platform that Yoshi can stand on.

### 6.2 $0EA Vertical / $0EB Horizontal Cloud Drops

Small white-cloud projectile-shaped enemies that ride a fixed axis.
Init at `Bank06:6393` / `Bank06:6612`.  Header bit $0010 on the position
selects direction:

| Sprite | Bit $10 = 0           | Bit $10 = 1            |
| ------ | --------------------- | ---------------------- |
| $0EA   | Drop down (Y +0180)   | Rise up (Y -FE70)      |
| $0EB   | Drift right (X +0180) | Drift left (X -FE70)   |

Animation read from `DATA_06B9C2` (frame indices) -- both directions
share the table but with separate starting indices ($000D vs $0006).
Stomp-rt (`Bank06:6582`) plays the head-bop frame animation
(`DATA_06BC9A` for $0EB; `DATA_06BA25` / `DATA_06BA2A` for $0EA) and
despawns.

Main has 3 skip gates:
1. `EXRAM_YI_Level_FreezeSpritesFlag` -- pause when sprites frozen
2. `RAM_YI_Level_TouchedFuzzyMosaicTimer` -- pause during fuzzy effect
3. `RAM_YI_Level_ItemBeingUsed` -- pause during morph cinematic

All three must be clear for the cloud to drift; one set freezes it
in place.  This is how morph cinematics (driven by transform bubbles)
visibly freeze the small clouds while the morph plays out.

### 6.3 Lakitu projectiles ($0A2 / $11D)

Both share the needlenose-family Init/Main shell at `Bank0E:6326`:

```
init_needlenose_family:    RTL  (bare stub)
main_needlenose_family:    -> dispatch by SpriteID
```

The Main checks `CurrentStatus,x` and `SpriteID,x`; matches against
$0A2 fork into a specialised Thunder-Lakitu-fireball animation path
(`CODE_main_thunder_lakitu_fireball`), then back into the shared
collision-and-cull path.  $11D (Wall Lakitu's projectile) uses the
shared Main without the fireball branch, so it just drifts ballistic
until contact or off-screen.

Thunder fireball ($0A2) has a 3-state self-destruct: at frame counter
$0030 from spawn, it forks into three child projectiles ($0049) on a
fan-out trajectory, then despawns -- this is the "lightning splits"
visual.


## 7. Per-sprite mechanics summary

A condensed per-ID summary for quick lookup.  See sections 2-6 for the
detailed handler walk-throughs.

- **$067** -- Hidden cloud revealed by rolling Chomp Rock / Snowball;
  position bits encode 1-of-4 payloads.  Bank0F.
- **$083** -- Bowser-fight ride platform; RNG-low-bits pick 1-of-4
  speed.  Bank04.
- **$0A2** -- Thunder Lakitu fireball; 3-state fan-out before despawn.
  Bank0E.
- **$0AF-$0B4** -- 5 morph bubbles (Car, Mole, Heli, Train, Sub).
  Shared `init_transform_bubble` + shared cloud Main; pop -> morph
  cinematic via per-SpriteID SuperFX glyph offset.  Bank03.
- **$0B5** -- Hidden Winged Cloud (watermelon-reveal); position-bits
  encode 4 payloads.  Bank03.
- **$0B6-$0CC (excl. $0CA)** -- 22 winged-cloud item variants; shared
  Init flavours + shared Main; per-SpriteID pop dispatch.  Bank03.
- **$0D9** -- Fishin' Lakitu; 6-state cruise/swing/recover; SuperFX
  fishing-line render; bait-tongue swaps state to $11C cloud handoff.
  Bank0E.
- **$0EA / $0EB** -- Cloud-drop small enemies (vertical / horizontal
  axis).  Bank06.
- **$11B** -- Standard cloud Lakitu; LakituActiveFlag singleton; 3-state
  cruise+throw; spawns $11C on stomp.  Bank07.
- **$11C** -- Rideable cloud post-Lakitu-cleanup; auto-scroll-aware
  drift; auto-despawn on timer / dismount.  Bank0D.
- **$11D** -- Wall-Lakitu spiny projectile; needlenose-family Main.
  Bank0E.
- **$149-$150** -- 8 fixed-direction arrow clouds; shared Main; pre-set
  `$18,x` direction-index.  Bank07.
- **$151** -- Rotating arrow cloud; same Main + per-frame divide-by-3
  to advance direction.  Bank07.
- **$157** -- Wall Lakitu; emerges from wall hole; 2-level nested state
  machine.  Bank07.
- **$166** -- Thunder Lakitu; 4-state cruise/charge/strike/recover;
  spawns partner Lakitu + thunder-segment ambients.  Bank07.
- **$170** -- Aqua Lakitu; underwater swim-and-shoot; SuperFX
  bottom-probe; $0099 Bullet Bill projectile.  Bank07.


## 8. Cross-references

Constants file:
- `yi/Constants/NormalSpriteIDs.asm` lines 121-129 (rock-revealed family
  comment block), 207-211 (watermelon hidden family comment block), and
  all entries for sprites listed in Section 1.

Companion docs:
- `docs/spritestateengine.md` -- state byte / dispatch architecture used
  by every sprite in this family.
- `docs/leveldataengine.md` -- header-bit position decoding (referenced
  by $067 / $0B5 variant-by-position mechanism).
- `docs/mchip.md` -- SuperFX routines invoked by cloud sprites:
  - `FXCODE_088619` -- 3-quadrant ring (cloud pop animation).
  - `FXCODE_0882F8` -- transform-bubble cinematic graphic.
  - `FXCODE_088A0F` -- polygon outlines (Bowser fight).
  - `FXCODE_0ACE2F` -- water-tile bottom-probe ($0170, winged-cloud
    register).
  - `FXCODE_09907C` -- projectile aim ($11B / $157).
  - `FXCODE_099011` -- Chomp-Rock/Snowball collision probe ($067).
  - `FXCODE_09906B` -- retry-collide probe ($067 follow-up).
  - `FXCODE_0B95E6` -- fishing-line position chain ($0D9).

Companion engine files (alternative naming, same handlers):
- `ys_enmy0.asm` -- standard Lakitu (matches $11B handler set).
- `ys_enmy3.asm` -- Lakitu cloud + rideable mechanism (matches $11C).
- `ys_enmy5.asm` -- Cloud-Drop enemies (matches $0EA/$0EB).
- `ys_enmy6.asm` -- Goonie family / cloud-drop variants.
- `ys_enmy7.asm` -- Arrow-cloud + Wall Lakitu + Thunder/Aqua Lakitu
  (matches all of Bank07's cloud cluster).
- `ys_enmy8.asm` -- Fishin' Lakitu (matches $0D9).

Raidenthequick + brunovalads V1.0 disassembly:
- `yoshisisland-disassembly/disassembly/bank07.asm` -- complete
  alternate-labelling for $11B / $149-$151 / $157 / $166 / $170.
- `yoshisisland-disassembly/disassembly/bank03.asm` -- winged-cloud
  Init/Main/pop-dispatch (note: that disassembly's `init_winged_cloud_*`
  / `main_winged_cloud` / `CODE_pop_*` labels are the source of the
  parallel aliases visible in our Bank03 alongside the templated
  `YI_NorSpr*_Init` labels).
- `yoshisisland-disassembly/disassembly/bank0D.asm` -- Lakitu-cloud
  ridemechanic.
- `yoshisisland-disassembly/disassembly/bank0E.asm` -- Fishin' Lakitu +
  Lakitu fireball.

Memory aliases used throughout this family:
- `!RAM_YI_Level_NorSpr_LakituActiveFlagLo` = `$0C3C` (singleton for
  $11B).
- `!RAM_YI_Level_NorSpr_FireLakituActiveFlagLo` = `$0C68` (singleton for
  $166 Thunder).
- `EXRAM_YI_Level_NorSpr_GenericTable701900` / `_701902` /
  `_701976` / `_7019D8` -- per-slot scratch used for variant index
  ($067 / $0B5 / $170), partner-link ($11B / $166), and death-state
  cache ($157).
- `$61B6` -- player's currently-mounted sprite slot (used by $11C cloud
  ride detection).
- `$6162` -- secondary mount slot used by Lakitu/Fishin' Lakitu when
  spawning a cloud child.


## 9. Open questions

- Whether $0C9 WingedCloudWithCrashGameFeature was originally intended
  to launch a separate bonus-game mode.  The pop dispatch is wired to
  `$0000` (no-op), but its name and slot positioning between gameplay
  variants suggests an unshipped feature.  Verifying would require
  running the cloud with a non-zero entry patched into
  `DATA_winged_clouds_bubbles_pops` and observing crash mode.

- Whether the divide-by-3 in $151 RotatingArrowCloud Main was designed
  to keep the rotation visually distinct from $11B Lakitu's spiny-throw
  cycle (which also runs on `$7A96` step-3) or for some other reason.
  The numerical 3 is shared by both Inits' multiplier setup, but the
  visual cadence is different.

- Whether $0EA / $0EB Cloud Drops were intended to spawn additional
  child sprites on hit-Yoshi (their Main runs through CODE_03A5B7 which
  is the general "sprite-hit-Yoshi" handler) -- they currently just hurt
  Yoshi without spawning anything visible.

- The interaction between Aqua Lakitu's water-probe SuperFX path
  (`FXCODE_0ACE2F`) and the same routine called by winged-cloud Init
  (`CODE_03C236`) -- the routines are bit-for-bit identical except for
  R0/R8 register setup.  Whether both use cases were designed around the
  same probe or whether one is a vestigial reference is unclear.
