# YI Spike / Needlenose / Cactus family reference

Standalone reference for the Yoshi's Island spiked-enemy family --
ground-rolling spike-monsters, sprite-fired spike-ball projectiles,
charging cacti, and the small porcupine-fish "needlenose" pellets they
spit. The connecting thread is the **shared needlenose family Init +
Main** at `Bank0E:6326-6478`: five sprites with completely different
spawn contexts and visuals (`$099` Spiny Egg, `$0A2` Thunder Lakitu
Fireball, `$0E5` Green Needlenose, `$0F9` Yellow Needlenose, `$11D`
alt Spiny Egg) all funnel through one `init_needlenose_family` (a bare
RTL) and one `main_needlenose_family` body that selects per-sprite
behaviour via an in-Main `CMP #!Define_YI_NorSprXXX` chain. Around
that family core sit eight more spike/cactus sprites that *spawn*
needlenoses or behave like one but run their own per-bank logic.

This doc complements:

- `docs/family-clouds.md` -- the $0A2 Thunder Lakitu fireball and the
  $11D wall-Lakitu Spiny Egg both belong to the cloud/Lakitu spawn
  ecosystem; their parent spawners + the fan-out attack are documented
  in that doc. Here we describe the *shared* family Init/Main body
  they're routed through and the per-Sprite-ID dispatch decisions.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_init`, `spr_state_main`, `spr_state_on_head_bop`,
  `spr_state_on_ride_yoshi`) that runs each Main entry every frame
  and routes Yoshi-bops on the entire spike family to the shared
  `CODE_head_bop_common` stub at `Bank03:4304`.
- `docs/family-piranhas.md` -- Blow Hard ($0F8 / $04C) and Ptooie
  ($09F) both *spit* `$0F9` (Yellow Needlenose) projectiles. The
  parent's spit + the projectile arc-velocity solver
  (`FXCODE_0B8595`) are documented there; here we document what the
  $0F9 child does once airborne.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank0E.asm` (needlenose family Main, Cactus Jack), with
companion code in `Bank04.asm` (Spike $074 + Spike Ball $075),
`Bank01.asm` (Harry Hedgehog $085), `Bank05.asm` (Heading Cactus
$0E4), `Bank0D.asm` (Chained Spike Ball $10C + chain-segment $10D),
`Bank0F.asm` (Bouncing Needlenose $163), and `Bank03.asm` (the giant
alias chains for Init / Main / StompRt / RideYoshiRt pointer tables
plus `CODE_head_bop_common`). Cross-verified against
`yoshisisland-disassembly/disassembly/bank0[1345DEF].asm`
(Raidenthequick descriptive labels `init_spike`, `main_spike`,
`init_spike_ball`, `init_hedgehog`, `init_heading_cactus`,
`init_cactus_jack`, `init_chained_spike_ball`,
`init_bouncing_green_needlenose`, and the family stub
`init_green_needlenose` / `main_green_needlenose`).

---

## 1. Family at a glance

Eleven sprites are in scope for this doc. The five-sprite shared
needlenose-family core is the central feature; the rest are
self-contained spiky enemies grouped here by visual + behaviour
relatedness.

| Sprite ID | Constant name | Bank | Init handler | Main handler | StompRt | Role |
|-----------|---------------|------|--------------|--------------|---------|------|
| `$074` | `Spike` | 04 | `$04:CCB1` `init_spike` | `$04:CCD3` `main_spike` | `head_bop_common` | Walks, periodically lobs `$075` Spike-Ball at Yoshi. 4-state machine (walk-and-spit / post-spit wait / rolling-ball subspawn / stunned-fall). |
| `$075` | `SpikeBall` | 04 | `$04:CE5E` `init_spike_ball` | `$04:CE70` `main_spike_ball` | `head_bop_common` | The projectile spawned by `$074`. 5-state machine (launch-arc / roll-along / bounce / post-collide cleanup / idle-stub). |
| `$085` | `HarryHedgehog` | 01 | `$01:AAE7` `init_hedgehog` | `$01:AAEC` `main_hedgehog` | `head_bop_common` | Spiky walking hedgehog. 2-state (walk / rolling-curled) plus egg-on-spikes hit-cling (`CODE_03AA52`). |
| `$099` | `SpinyEgg` (needlenose-family member) | 0E | `$0E:B1B2` `init_needlenose_family` (RTL) | `$0E:B1B3` `main_needlenose_family` | `head_bop_common` | Tossable spiked-egg projectile -- one of 5 sprites sharing the family Init/Main. Spawns AmbSpr1DF damage burst on terrain or player contact. |
| `$0A2` | `ThunderLakituFireball` | 0E | `$0E:B1B2` shared (RTL) | `$0E:B1BE` own Main (sub-routine of family Main) | `head_bop_common` | Lightning-ball projectile thrown by Cloud Drop's Lakitu. Trails AmbSpr20F per 4 frames; on contact splits into 3 `$0049` chunks via `CODE_0EB302`. **Cross-ref doc: `docs/family-clouds.md`.** |
| `$0E4` | `HeadingCactus` | 05 | `$05:E0F8` `init_heading_cactus` | `$05:E13D` `main_heading_cactus` | `head_bop_common` | Charging cactus. On init, spawns a permanently-linked `$0E5` needlenose held to its forehead via slot link `$18,x`. 6-state machine (idle / wind-up / spit / cooldown / hit / defeat). |
| `$0E5` | `GreenNeedlenose` | 0E | `$0E:B1B2` shared (RTL) | `$0E:B1B3` shared `main_needlenose_family` | `head_bop_common` | Small spiky porcupine-fish projectile. Spawned by Heading Cactus, Cactus Jack, Spike, and as a standalone enemy. Damages Yoshi on contact via `CODE_03A858`. |
| `$0F9` | `YellowNeedlenose` | 0E | `$0E:B1B2` shared (RTL) | `$0E:B1B3` shared `main_needlenose_family` | `head_bop_common` | Yellow colour variant of `$0E5`. Spawned by Blow Hard ($0F8/$04C) and Ptooie ($09F) -- see `docs/family-piranhas.md` §3, §4. Behaviour identical to `$0E5` (in-Main branch falls into same ambient-spawn path). |
| `$10C` | `ChainedSpikeBall` | 0D | `$0D:89FF` `init_chained_spike_ball` | `$0D:8AF1` `main_chained_spike_ball` | `head_bop_common` | Ceiling-hung spiked ball on a chain. Init runs slot-leader pattern via global `$0FB7`/`$0FB9`, recursively spawns `$010D` chain-segment children counted in `$0FBB`; queries `FXCODE_0ACDFA` to measure ceiling-to-spike distance + render the chain. |
| `$11D` | `SpinyEgg` (alt ID) | 0E | `$0E:B1B2` shared (RTL) | `$0E:B1B3` shared `main_needlenose_family` | `head_bop_common` | Alt Spiny Egg ID used by other handlers to spawn a 2nd Spiny Egg instance (Wall Lakitu's projectile, second-spawn slot). Falls into the same `$1DF` ambient-spawn path as `$099`/`$0E5`/`$0F9`. **Cross-ref doc: `docs/family-clouds.md`.** |
| `$156` | `CactusJack` | 0E | `$0E:B839` `init_cactus_jack` | `$0E:B92E` `main_cactus_jack` | `head_bop_common` | Tall stationary cactus enemy. Init probes terrain via `FXCODE_0ACE2F` to find a ground anchor. 8-entry state ptr `DATA_0EB91E`. Spawns spike-ball projectiles via `CODE_0EC858`. Head-bop transitions state to `$03` via `$7AF6` timer. |
| `$163` | `BouncingNeedlenose` | 0F | `$0F:9111` `init_bouncing_green_needlenose` (RTL) | `$0F:9116` `main_bouncing_green_needlenose` | `head_bop_common` | Hopping spike enemy. Main = `CODE_03AF23` + on-ground test; on land plays SoundID13 + applies hop Y-velocity from 2-entry table `DATA_0F9112`. `$18,x` caps the hop count at 2. |

All eleven in-scope sprites + the 5-sprite needlenose-family cluster
all share the same Bank03 alias chains:

- **StompRt is a fall-through into `CODE_head_bop_common`**
  (`Bank03.asm:4304`). None of these sprites die from a Yoshi-bop;
  the handler runs one Main render-tick then applies OAM-front-priority
  + a $0400 Yoshi-ground-bonk recoil. Yoshi cannot stomp a spiky
  enemy.
- **RideYoshiRt is a bare RTL** in the giant alias chain ending at
  `Bank03.asm:3458`. Yoshi cannot stand on these enemies for
  ride-physics; if he touches one from above without an egg or star,
  he takes damage via `CODE_03A858`.

The two stompability constraints are the "this is a spiky enemy" tax
that every member of this doc shares.

---

## 2. The shared `main_needlenose_family` body ($099 / $0A2 / $0E5 / $0F9 / $11D)

The five-sprite family core lives at `Bank0E:6395-6506`. Every member
has its own Init label (`YI_NorSpr099_SpinyEgg_Init` etc.) but they
all resolve to the **same RTL stub**:

```
YI_NorSpr099_SpinyEgg_Init:
YI_NorSpr0A2_ThunderLakituFireball_Init:
YI_NorSpr0E5_GreenNeedlenose_Init:
YI_NorSpr0F9_YellowNeedlenose_Init:
YI_NorSpr11D_SpinyEgg_Init:
init_needlenose_family:
;$0EB1B2
    RTL
```

That's the entire Init. All five sprites delegate their setup to the
*spawner* that created them -- whoever called `CODE_spawn_sprite_init`
or `CODE_spawn_sprite_active` (Heading Cactus, Cactus Jack, Spike,
Blow Hard, Ptooie, Wall Lakitu, Cloud Drop) is expected to seed the
needlenose's `$70E2`/`$7182`/`XSpeed`/`YSpeed`/`$7400` directly into
the freshly-allocated slot.

### 2.1 The shared Main entry

The Main entry at `Bank0E:6413`:

```
main_needlenose_family:
;$0EB1B3
    LDA  !EXRAM_YI_Level_NorSpr_CurrentStatus,x
    CMP  #$0010                     ; alive + no special status
    BNE  CODE_main_thunder_lakitu_fireball
    JSR  CODE_0EB27C                ; player-collision + terrain hit-test

CODE_main_thunder_lakitu_fireball:   ; = $0EB1BE
    JSL  CODE_03AF23                 ; gravity / generic per-frame
    LDA  !EXRAM_YI_Level_NorSpr_SpriteID,x
    CMP  #!Define_YI_NorSpr0A2_ThunderLakituFireball
    BNE  CODE_0EB1CD
    JSR  CODE_0EB27C                 ; SECOND collision pass (Thunder only)
CODE_0EB1CD:
    JSR  CODE_0EB1D4                 ; per-Sprite-ID effect-spawn fork
    JSR  CODE_0EB23F                 ; held-by-tongue / Yoshi-eat handler
    RTL
```

Two surprising mechanics here:

**Thunder fireball gets two collision passes per frame.** When the
status word `!EXRAM_YI_Level_NorSpr_CurrentStatus,x` is `$0010`
("alive"), `CODE_0EB27C` runs once *before* gravity. Then for the
Thunder Lakitu fireball ($0A2) only, the same routine runs *again*
after gravity. The double-test makes the lightning ball more
collision-aggressive than its silent-pellet cousins -- it will detect
a Yoshi-overlap both at its pre-gravity position and at its
post-gravity position in the same frame. This is the *only* sprite in
the family to get this treatment.

**Pre-gravity collision for non-Thunder.** The status-check `BNE` on
the very first instruction means: if a needlenose is in any state
other than alive+alive (e.g. `$0008` "post-contact"), it skips its
own first collision and falls straight through to gravity. So when a
$0E5 lands and starts despawning, it can't double-hit Yoshi.

### 2.2 The Sprite-ID dispatch in `CODE_0EB1D4`

This is the family's *real* logic. Every alive needlenose hits this
routine after gravity:

```
CODE_0EB1D4:
    LDA  $7A38,x : ORA $7A98,x   ; either cooldown active?
    BNE  CODE_0EB23E             ; yes -- skip the ambient-spawn this frame
    LDA  #$0004
    STA  $7A98,x                 ; arm the 4-frame ambient cooldown

    LDA  !EXRAM_YI_Level_NorSpr_SpriteID,x
    CMP  #!Define_YI_NorSpr0A2_ThunderLakituFireball
    BNE  CODE_0EB20A                  ; non-Thunder -> ambient-1DF branch

    ; --- Thunder Lakitu fireball: trail spawn ---
    LDA  #!Define_YI_AmbSpr20F        ; lightning-trail ambient sprite
    JSL  CODE_spawn_ambient_sprite
    ; copy parent position into trail
    LDA  $70E2,x : STA $70A2,y
    LDA  $7182,x : STA $7142,y
    LDA  #$0005 : STA $73C2,y         ; lifespan
    LDA  #$0001 : STA $7782,y
    RTS

CODE_0EB20A:
    CMP  #!Define_YI_NorSpr0F9_YellowNeedlenose
    BEQ  CODE_0EB21A                  ; Yellow -> share Green's ambient body
    CMP  #!Define_YI_NorSpr0E5_GreenNeedlenose
    BEQ  CODE_0EB23E                  ; Green -> SKIP this frame (return)
    ; -- $099 or $11D fall through here --
    LDA  #$0008 : STA $7A98,x         ; Spiny Eggs get a LONGER cooldown

CODE_0EB21A:
    LDA  #!Define_YI_AmbSpr1DF        ; damage burst ambient
    JSL  CODE_spawn_ambient_sprite
    ; ... copy position, set lifespan, etc.
    RTS
```

The taxonomy this dispatch carves out:

| Sprite ID | Cooldown | Spawned ambient | Notes |
|-----------|----------|-----------------|-------|
| `$0A2` Thunder | $0004 | `!Define_YI_AmbSpr20F` (lightning trail) | Plus a 2nd collision pass (§2.1). |
| `$099` SpinyEgg | $0008 (LONG) | `!Define_YI_AmbSpr1DF` (damage burst) | Doubled cooldown -- twice as silent between bursts. |
| `$11D` SpinyEgg-alt | $0008 (LONG) | `!Define_YI_AmbSpr1DF` (damage burst) | Same as $099. |
| `$0F9` YellowNeedlenose | $0004 | `!Define_YI_AmbSpr1DF` (damage burst) | Shares Green's spawn block; uses default $0004 cooldown. |
| `$0E5` GreenNeedlenose | $0004 | **none** (RTS early) | The "silent" pellet. Falls into `CODE_0EB23E` -- which is just RTS. |

The asymmetry is striking: Green Needlenose is *quieter* than Yellow.
On the same Init+Main code path, with the same cooldown clock, Green
emits no ambient sprite and Yellow emits an `$1DF` damage-burst. The
only mechanical difference between Green and Yellow is whether they
trail visual damage particles -- behaviour, position, sound, and
collision are otherwise identical.

### 2.3 The collision routine `CODE_0EB27C`

Each needlenose has two ways to die: it can hit a wall/ceiling/floor
or hit Yoshi. Both routes go through `CODE_0EB27C`. The routine
first checks `$18,x` (parent-slot back-link) -- if the parent is
still alive, the projectile is still being aimed and skips
collision. Otherwise it samples `$7860,x` (corner-collision flags
BL/BR/TL/TR) and uses the 4-entry `DATA_0EB270` table (`$0018,
$0010, $0008, $0000`) to pick a corner-byte offset.

That offset is added to the parent-spawn-X stash at
`!EXRAM_YI_Level_NorSpr_GenericTable701902,x` to produce a Map16
cell address, then queries `$70000C,x` for the cell's class-bits.
On match against `$4000` ("despawn trigger"), the routine forks on
SpriteID: Thunder Lakitu fireball ($0A2) goes to `CODE_0EB302` for
its 3-chunk fan-out; everyone else jumps to `CODE_0EB257` for a
generic `CODE_03B25B` detach + `CODE_03A31E` despawn.

### 2.4 The Thunder Lakitu fireball fan-out (`CODE_0EB302`)

When the Thunder Lakitu fireball ($0A2) hits anything, it doesn't
just despawn -- it explodes into a 1+2 burst. `CODE_0EB302` first
spawns one `$004A` sprite (the "chunk-A", centred + vertical) via
`CODE_spawn_sprite_active`, seeding its lifespan and animation
fields. It then loops twice, each iteration spawning a `$0049`
("chunk-B") via `CODE_spawn_sprite_init` and stamping the
X-velocity from `DATA_0EB278 = $0200, $FE00` -- one chunk left at
`$FE00`, one chunk right at `$0200`. Finally `CODE_0EB358` triggers
camera-shake (`$61C6 = $0020`), plays `!Define_YI_SoundID3E_Tongue`
(the tongue-spit cue, *reused* as the lightning impact sound), and
despawns self via `CODE_03A31E`. Documentation of the $49/$4A
children lives in `docs/family-clouds.md` §6.3.

---

## 3. The Heading Cactus + spawned Needlenose ($0E4 + $0E5)

The Heading Cactus is the most-instrumented spawner of a needlenose
in the game. Init at `Bank05:13063` does three notable things:

**It pre-spawns its needlenose.** Most spike-family parents spawn
projectiles from a state handler. The Heading Cactus spawns a
*permanent* attached `$00E5` child as part of Init via
`CODE_spawn_sprite_active`, copies position into child (child Y =
parent Y - $10), stores the child slot index in its own `$18,x`,
and jumps immediately to state $02. The needlenose is always
present -- even before the cactus charges.

**The DEC pre-arms a "missing child" sentinel.** `DEC.b $18,x`
sets `$18,x = $FFFF` before the spawn attempt. If
`CODE_spawn_sprite_active` fails (carry clear -- "no free slot"),
the `STY.b $18,x` is skipped via `BCC`. Then Main tests
`LDY.b $18,x : BMI` for "no linked child" and skips per-child
logic.

**World tier sets attack speed.**
`!EXRAM_YI_Level_NorSpr_GenericTable701900` caches an index used
in state $02 to pick an attack-velocity tier from
`DATA_05E207`/`DATA_05E20B`/`DATA_05E20F`/`DATA_05E213`. World 1
gets the *slower* tier (index 0); every later world gets the
*faster* tier (index 2). A Heading Cactus in World 1 lobs its
pellets at `$FC00` upward Y-velocity, while a Heading Cactus in
World 2+ shoots at `$FB00` (steeper / faster).

### 3.1 The state machine (`DATA_heading_cactus_state_ptr`, 6 entries)

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_05E179` | **Idle, await wind-up.** Watches `$7A96` cooldown; on expiry, spawns a *second* `$00E5` ("ammo reload"), copies position into it, stashes its slot in `$18,x`, arms 32-frame timer, advances. |
| `$01` | `CODE_05E1A4` | **Wind-up.** Per frame, decrements the needlenose's Y-position by 1 (it rises up out of the cactus). When the relative Y-delta hits `$FFF3` (=$0D pixels above cactus), arms 32-frame wind-up timer, advances. |
| `$02` | `CODE_05E1EF` | **Spit.** Looks up world-tier velocities from `DATA_05E207`/`DATA_05E20B` and assigns them to the needlenose's `YSpeed` + `$7542`/`$75E2` (accel) -- effectively *launches* the linked child. Per-frame applies anim-table indexes from `DATA_05E1D7`/`DATA_05E1DC`/`DATA_05E1E1`/`DATA_05E1E6` (5-entry pose / hold tables). Advances on $7A36 underflow. V1.1 adds a `$7222,y` egg-stick check that skips re-launching a stuck pellet. |
| `$03` | `CODE_05E28F` | **Post-spit cooldown.** Per `DATA_05E289` (3-entry Y-adjust table), restores the needlenose to its pre-spit perch. On position match, arms 2-frame cooldown + advances. |
| `$04` | `CODE_05E2C2` | **Hit / disabled.** Egg-bounced state. 4- or 5-entry table `DATA_05E2B7` for pose-frame; per-state-byte index in `$78,x` picks between fast (`DATA_05E2BF`) and slow (`DATA_05E2BB`) recover. |
| `$05` | `CODE_05E300` | **Defeat / despawn.** 8-frame anim-tick countdown via `$7A98`; when `$7402` underflows, arms 384-frame respawn delay (`$7A96 = $0180`) and jumps back to state $00 (the cactus self-rebuilds its needlenose after a defeat!). |

State $05's "respawn cycle" is a quietly important behaviour: a
Heading Cactus is never actually killed by egg-bonk. It loses its
visible needlenose for `$0180` frames (~6 seconds) and then comes
back. This is consistent with the rest of the spike family -- they're
all non-stompable nuisances rather than score-targets.

### 3.2 The child-detection main-entry probe

At the top of `main_heading_cactus`, every frame the parent probes
its linked child slot. After gravity + the carry-item-transfer
hook, it loads `LDY.b $18,x` and tests three conditions on the
linked slot:

1. `CurrentStatus,y == $0010` -- child must be alive.
2. `GenericTable7019D6,y == 0` -- child sub-state must be idle.
3. `SpriteID,y == $00E5 GreenNeedlenose` -- the slot must STILL
   contain a Green Needlenose, not something else.

If any fails, the cactus severs the link (`$18 = $FF`), arms a
96-frame defeat delay (`$7A98 = $0060`), and jumps to state $05.

**The cactus literally tests if its needlenose has been swapped for
a different sprite.** This is the rare slot-link contract where the
*child's identity* is part of the parent's state machine, defending
against slot-recycling after Yoshi eats the pellet.

---

## 4. Spike + Spike Ball -- the parent/child pair ($074 + $075)

Sprite `$074` (the "Spike" walker) is a `Spike` in the Mario sense --
a hedgehog-looking enemy that spits a *separate* projectile sprite at
Yoshi.  Sprite `$075` is the rolling spike-ball it spits.

### 4.1 The Spike walker ($074)

Init at `Bank04:9684`:

```
init_spike:
    INC.b $78,x                  ; arm $78 = 1 (will be used as carry flag)
    LDY  #$00
    LDA  !EXRAM_YI_Player_XPosLo
    SEC : SBC  $70E2,x           ; player relative-X (positive = right)
    BMI  +                       ; player left of us
    INY : INY                    ; player right of us
+:
    TYA : STA  $7400,x           ; facing (0 = left, 2 = right)
    LDA  DATA_04CCAD,y           ; pick initial X-velocity ($FFBD / $0046)
    STA  $75E0,x                 ; ... and write to acceleration / friction
    RTL
```

`DATA_04CCAD` = `$FFBD, $0046` -- a signed X-velocity pair. The Spike
picks its facing **and initial walk-velocity by sniffing the player's
position at spawn time**, then keeps walking. The 2-byte table
encodes "walk left fast" (-67) and "walk right slow" (+70) -- the
asymmetry means a player who spawns the Spike to their right gets a
slow-approach enemy, while spawning it to their left gets a
fast-approach one. This is the only sprite in the family with a
spawn-time velocity asymmetry.

The 4-state machine `DATA_spike_state_ptr` (`Bank04:9705`):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_spike_state_00_walk_and_spit` | **Walk + look for spit window.** `$7402` controls a 5-frame "rear-up" anim (`DATA_04CD23 = $0C, $20, $18`). Outside anim frames, watches `$7C16,x` (player relative X) and `$7C18,x` (player relative Y) for in-range; when in-range, spawns `$0075` and seeds child's `$70E2`/`$7182` to match parent. Stores parent slot index in child's `701978,y`. |
| `$02` | `CODE_spike_state_01_post_spit_wait` | **Post-spit wait + ball launch.** On `$7A96 == 0`, kicks the child's `YSpeed = $FE9A` (strong upward arc) and `XSpeed = DATA_04CE21[facing] = $0059 / $FFA7`. Effectively *launches* the linked child via parent's per-frame update. |
| `$04` | `CODE_spike_state_02_rolling_ball_subspawn` | **Stunned on floor.** Watches floor bit `$7860 & $0001`; on land, clears X-velocity, arms 96-frame stun (`$7A98 = $0060`), rewinds state to 0. |
| `$06` | `CODE_shy_guy_state_02_stunned` | **Stunned (shared with shy-guy).** Cross-bank state alias -- the Spike's "stomp recovery" runs the shy-guy state-02 stunned body verbatim. |

The state-byte values are 0, 2, 4, 6 (word-stride). State `$06` is an
**inter-bank state-alias**: the `dw CODE_shy_guy_state_02_stunned`
points back into Bank04's shy-guy code. So a Spike's stomp-recovery is
literally the same code path as a shy-guy's. The Spike inherits the
shy-guy's stun-then-flip-then-fall behaviour, sharing the bank's
shared stunned state handler.

### 4.2 The Spike Ball projectile ($075)

Init at `Bank04:9921`:

```
init_spike_ball:                  ; $04:CE5E
    JSR  CODE_04CF1A              ; one-shot SuperFX OAM seeder
    RTL
```

`CODE_04CF1A` seeds the SuperFX render registers (`R5`/`R6`/`R8`/`R9`,
plus the `FXCODE_08D69F` rotate-and-blit routine). The init is
otherwise empty; the parent Spike has already stamped position +
velocity into the new slot before calling `init_spike_ball`.

The 5-state machine `DATA_spike_ball_state_ptr` (`Bank04:9933`):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_spike_ball_state_00_launch_arc` | **Launch / arc.** `$7A36,x` increments by $0009 per frame, clamped to $01FF. While < $01FF, the ball is on the rising arc. On clamp, advances state. |
| `$02` | `CODE_spike_ball_state_01_roll_along` | **Roll along ground.** `$7A38,x` decrements by $0008 per frame (AND $01FE keeps it wrapped); when < $0160, advances. This is the rolling animation phase. |
| `$04` | `CODE_spike_ball_state_02_bounce` | **Bounce off terrain.** `$7A38,x` increments by $0008; on $\geq $0180, looks up `DATA_04CF9E` (= `$FDE7, $0219`) keyed by `$7400,x` (facing), assigns to XSpeed (reverses bounce direction), clamps `$7A38 = $0160`, advances. |
| `$06` | `CODE_spike_ball_state_03_post_collide_cleanup` | **Post-collide cleanup.** `$7A38,x += $0008` and continues. No state advance -- this is a sink. |
| `$08` | `CODE_shy_guy_state_05_stub` | **Idle stub (TYX/RTS).** Reaches via the main-entry override below. |

The state-byte values are 0, 2, 4, 6, 8 (word-stride).

### 4.3 The "kill-Yoshi-then-bounce-off" Main override

`main_spike_ball` has an in-entry decision tree before dispatch:

```
main_spike_ball:                  ; $04:CE70
    LDY  $74A2,x : BMI +          ; "ride Yoshi" hook -- skip terrain hit-flash
    JSL  CODE_03AA52              ; egg-on-spikes hit-cling
+:
    JSL  CODE_03AF23              ; gravity / standard frame
    LDY.b $18,x                   ; PARENT slot index back-ref
    LDA  !EXRAM_YI_Level_NorSpr_CurrentStatus,y
    CMP  #$0010 : BNE .check_state
    LDA  $7D38,y                  ; "parent is being held / carried"
    BEQ .all_good                 ; parent unharmed -> normal dispatch
.check_state:
    LDY.b $76,x : CPY #$03 : BPL .all_good
    ; -- parent died or got grabbed AND we're in state 0/2/4 --
    LDA  #$02CC : STA $75E2,x     ; arm Y-accel (gravity tick)
    LDA  #$002C : STA $7542,x
    LDY  #$04 : STY.b $76,x       ; jump to state $08 (idle stub)
.all_good:
    ; -- standard dispatch --
    TXY : LDA  $76,x : ASL : TAX
    JSR (DATA_spike_ball_state_ptr,x)
    ...
```

The ball checks if its **parent Spike** is still alive (`CurrentStatus
= $0010` and not held-by). If the parent has died mid-arc (e.g.
Yoshi ate the parent during the spit anim), the ball jumps to state
$08 (the idle stub), arms gravity, and effectively becomes a falling
ball with no further behaviour -- it'll fall off-screen and despawn
naturally.

Two more interesting bits:

- The collision check at `$04:CEDF` uses the standard
  `$60A8`/`$60B4` per-frame XSpeed mirror that `CODE_03A858` reads to
  determine the *direction* of the hit. The ball stamps its own
  XSpeed into both global vars before calling `CODE_03A858`, ensuring
  Yoshi gets knocked back in the rolling direction (and not just
  "downward").
- `$61D6 != 0` (the "Yoshi is currently in a special cutscene state"
  flag) gates the collision call to `CODE_03A858`. So a rolling spike
  ball does not hit Yoshi during, e.g., morph transition cinematics.

---

## 5. Chained Spike Ball -- the slot-leader pattern ($10C)

The `$10C` Chained Spike Ball is the spiked-ball-on-a-chain hazard
seen in fort/castle stages. It uses a **multi-slot recursive
spawning** pattern unlike anything else in the family.

### 5.1 The slot-leader contract via global `$0FB7`/`$0FB9`/`$0FBB`

Init at `Bank0D:1336`:

```
init_chained_spike_ball:
;$0D89FF
    LDA  $0FB7                   ; "is there already a leader for this chain?"
    BEQ  .first_in_chain          ; no -> we're the first
    CPX  $0FB7 : BMI .skip_leader_update
    STX  $0FB7                   ; we're higher slot -> become new leader
.skip_leader_update:
    LDA  $0FB9 : STA $7722,x     ; copy leader's $7722 (palette/style)
    BRA  .spawn_segment

.first_in_chain:
    JSL  CODE_03AE60             ; standard parent-on-spawn init
    STX  $0FB7                   ; we are the new leader
    LDA  $7722,x : STA $0FB9     ; cache leader's palette globally

.spawn_segment:
    INC  $0FBB                   ; chain-segment counter
    LDA  #$010D                  ; spawn a "chain segment" ($10D)
    JSL  CODE_spawn_sprite_active
    BCS  .have_segment

    ; -- segment-spawn failed: roll back --
    DEC  $0FBB
    BNE  +                       ; still other segments alive? keep going
    STZ  $0FB7                   ; we were the only one -> drop leadership
+:
    JML  CODE_03A31E             ; despawn ourselves
```

The three globals at the level scope:

| Address | Meaning |
|---------|---------|
| `$0FB7` | **Slot index of the current chain leader** ($FFFF if no chain alive). Updated each time a higher-slot $10C spawns. The leader is the *visible spike head* that hangs on the chain; chain segments are non-leader $10D children. |
| `$0FB9` | **Leader's palette / style** (`$7722` mirror). Used so subsequently spawning segments inherit the same colour. |
| `$0FBB` | **Total number of $10D chain segments currently alive.** Incremented on segment spawn; decremented when a segment despawns. When it hits 0, `$0FB7` is cleared (no leader). |

When a $10C Init runs, it competes for leadership: if its slot index
is *higher* (lower in memory order) than the existing `$0FB7`, it
becomes the new leader. This handles the case where multiple Chained
Spike Balls were placed in one level -- they each get their own chain
without colliding, because each $10C asks for an `$010D` child slot
and tracks its own chain-segments via `$18,x = child slot index`
linking back.

### 5.2 The recursive chain layout

After the leader is decided, Init spawns one `$010D` segment, links
it via `STY.b $18,x` (parent's $18 = child slot), then queries
SuperFX `FXCODE_0ACDFA` to measure the ceiling-distance. The query
returns a 0-19 LOOP-counter value; values $\geq $0B become `#$8000`
(sentinel "draw 1 segment only"); shorter values are converted to
`(19 - distance) * 16` and stamped into `$7A36,x` as the chain-
length parameter. Init also offsets `$7182,x` by `+$0030` to drop
the visible spike-head 48 px below the cactus base, and renders a
one-shot SuperFX blit via `FXCODE_088293` for the spike texture.

The Main entry (`main_chained_spike_ball`) re-queries the ceiling
every frame via `CODE_0D8B3B`, and re-renders the per-segment dots
via `CODE_0D8B8B` (an 11-iteration loop that stamps OAM bytes for
individual chain links). So the chain *redraws every frame* in
response to player movement (the chain visually swings as Yoshi
walks under it).

### 5.3 The 5-state machine

`DATA_0D8AE7` at `Bank0D:1440` (5 entries, word-stride):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0D8CB5` | **Idle / wind-up.** Watches `$78,x` for windup; when triggered, sets the *segment*'s anim+sound state via the linked-child slot in `$18,x`, advances. |
| `$02` | `CODE_0D8CFA` | **Lower / fall.** Plays `!Define_YI_SoundID2F_ClankSound8` every 4 frames. On `$7182` underflow vs parent-Y delta, halts Y-velocity, arms `$7542 = $0008` accel, advances. |
| `$04` | `CODE_0D8D36` | **Bounce + sound.** Plays `!Define_YI_SoundID1B_MaceTick` on contact. Spawns `!Define_YI_AmbSpr1F1` on floor-hit, plus `!Define_YI_SoundID47_Explosion` + camera-shake (`$61C6 = $0020`). |
| `$06` | `CODE_0D8DC4` | **Rebound / climb back.** Adds $0004 per frame to `$78,x`; when match-distance reached, arms segment's anim+sound + 32-frame timer, advances. |
| `$08` | `CODE_0D8E06` | **Settle / idle-loop.** On `$7A96 == 0`, watches segment's `7019D6,y` state byte; on `$0005` ("ready to repeat"), resets to state $00. |

V1.1 introduces a `$72C2,x` velocity-damping branch in state $02 that
V1.0 lacks; otherwise the cycle is identical.

### 5.4 The leader despawn drops the whole chain

When the leader's `CODE_03A2C7` offscreen-cleanup returns
carry-set, the Main entry cascades: `LDA.b $18,x : TAX :
JSL CODE_03A31E` despawns the linked segment first; then decrements
`$0FBB`; if it hits 0, clears `$0FB7` (no chains alive) and calls
`CODE_03AEFD` (global tile-cleanup); finally despawns itself with
`$7722 = $FFFF` (clear anim slot). The chain is always ordered-
despawned head-to-tail.

---

## 6. Harry Hedgehog ($085)

The standalone "rolling spiked hedgehog" enemy. Init at `Bank01:5271`
is a bare RTL. The 2-state machine `DATA_01AAE8`:

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_01AB6A` | **Walking.** Picks an X-velocity from `DATA_01AB62` (= `$FE80, $0180, $0010, $FFF8`) keyed by `$7400,x` (facing). Watches `$7C16`/`$7C18` for player-in-range AND `CODE_03AD74` (egg-carry check); on triggers, sets palette `$2175`, resets anim, arms `$7A36 = $0080`, advances. Otherwise spawns a 2-frame puff ambient `!Define_YI_AmbSpr1D8` (the "rolling dust" puffs). |
| `$02` | `CODE_01AC06` | **Rolling / curled.** Reads Yoshi-facing reference from `$77C2,x`, stamps it into `$7400,x` (i.e. hedgehog always faces Yoshi while rolling). Watches `$7D36,x` (held-by); on held-by detection, force-detaches via `CODE_03B25B` + clears anim. Cycles `$7A36` (mouth-open angle): ramps up by $0010 to $0100, then resets to $0080 with palette $0974. The 16-frame cycle is the curl/uncurl animation. |

The state-byte values are 0, 2 (word-stride). The 4-entry `DATA_01AB62`
table at the walking handler is a quadruple: 2 entries are velocity
(`$FE80` left-fast, `$0180` right-medium) and 2 more (`$0010,
`$FFF8`) appear unreferenced -- possibly slow-walk velocities for an
unused 4-direction walking mode.

Egg-on-spikes is implemented in Main: `LDA $7040,x : LSR : BCC +` --
if `$7040,x` bit 0 is set, calls `CODE_03AA52` (the egg-on-spikes
hit-cling routine). This is how Yoshi's eggs *stick* to a hedgehog
when thrown rather than bouncing.

The SuperFX renderer chain is `FXCODE_08D964` (a rotate-and-blit at
`FXDATA_548000+$6000`), called when `$7040 & 1` is set -- so the
hedgehog only renders via SuperFX during its "rolling / curled"
phase. During walking, OAM is built by the standard sprite path.

---

## 7. Cactus Jack ($156)

The "tall standing cactus" enemy. Init at `Bank0E:7286` does two
unusual things:

**Terrain probe via `FXCODE_0ACE2F`.** `CODE_0EB8AE` queries
SuperFX to probe the Map16 tile directly below the Cactus Jack's
spawn position. If solid ground is found, the cactus snaps to it
(adjusting Y by `+$10`, caching pre-ground Y in `701902,x`) and
flips its OAM vertical-priority bits. If no immediate ground,
`CODE_0EB8DC` does a multi-cell probe in 16-pixel steps -- looking
up to 16 tiles down before giving up; on success it jumps to state
$02. This is the family's only sprite that *grounds itself
dynamically* at spawn.

**Pre-decrement of `$18,x` as sentinel.** Same idiom as Heading
Cactus: `$18,x = $FFFF` means "no projectile child linked". Init
also stamps `$78,x = $0100` (angle reference), `$7BB6/$7BB8 =
$0006` (OAM extents), and copies the global frame counter `$7974`
into `$75E0` as an accel seed.

### 7.1 The 8-state machine `DATA_0EB91E` (`Bank0E:7401`)


| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0EBD1E` | **Idle (rooted).** Watches `$7C16,x` (player relative X within +-80 px). On trigger, arms upward jump (`YSpeed = $FA00`, `$7542 = $0060`). Watches `$7223,x` (egg-hit-block flag); on egg-hit, snaps to `$701902` Y-position (pre-ground), clears velocities, advances. |
| `$02` | `CODE_0EBD67` | **Angle wobble.** Uses 2-entry tables `DATA_0EBD5F` (= `$FFFC, $0008`) and `DATA_0EBD63` (= `$00E0, $0140`) to cycle `$78,x` (angle) between two bounds. EOR `$16,x` toggle on bounds-hit -- the cactus tilts side-to-side. |
| `$04` | `CODE_0EBD87` | **Touched ground / land.** Watches `$7681,x` (Y-velocity accumulator); on zero, snaps Y to `$609C - $20` (1 tile above ground), arms `$7542 = $0060`, sets `$74A2 = $0005` (sub-state pointer), clears `$6FA2`, advances. |
| `$06` | `CODE_0EBDA9` | **Spit projectile + ground-recover.** When `$7542 == 0` (just landed), runs the ground-probe again (`CODE_0EB8DC`). On Y-match with stored `701902,x`, AND on `$7A96 == 0`, spawns *another* Cactus Jack ($156) -- not a needlenose! -- and links it via `701978`. New child spawns with `7019D6,y = $0006` (a child-state-tag). This appears to be a **two-stack Cactus Jack tower** mechanic: a Cactus Jack on the ground can spawn another one stacked above it. |
| `$08` | `CODE_0EBE5E` | **Roll attack -- wait for X-velocity zero.** On `XSpeed == 0`, advances. Else jumps to `CODE_0EC858` (the spike-ball spit code, shared with other sprites). |
| `$0A` | `CODE_0EBE6A` | **Land + freeze.** On floor-bit `$7860 & 1`, masks OAM priorities, clears state + velocities, jumps to state $03 (or thereabouts -- `LDY #$03 : STY $76`). |
| `$0C` | `CODE_0E8000` (placeholder) | Stub. Reaches sprite-base; reads as RTS/RTL. |
| `$0E` | `CODE_0E8000` (placeholder) | Same stub. |

The two final placeholder slots pointing to `CODE_0E8000` are
unused. The state table is declared 8-entries wide for word-stride
alignment, but only the first 6 are reachable from the in-Main state
transitions.

### 7.2 The Cactus Jack vs other Cactus Jack collision

`CODE_0EBA09` / `CODE_0EBAB7` -- called from a SuperFX-driven loop
(`FXCODE_099011`/`FXCODE_099011B`) -- iterates all alive normal
sprites looking for *another* Cactus Jack (`SpriteID == $156`). When
found, it cross-checks `$75E0,x == $75E0,y` (matching accel-tier),
`6FA0,y & $0200` (the right OAM-priority subfield), and
`701978,y == $0004` (specific child-link slot value). On match, the
two Cactus Jacks **collide and knock each other off-screen** -- one
fires a sound from the 7-entry table `DATA_0EB9D4` (SoundID0C through
SoundID12 -- a series of "ShellHit" cues) and both arm `$7542 = $0060`
+ `$7D38 = $0001` (held-by flag).

This is the only sprite in the spike family that has explicit
**same-sprite-vs-same-sprite collision**. Two Cactus Jacks placed
near each other in a level will produce a visual two-stack collision
cycle.

---

## 8. Bouncing Needlenose ($163) -- the hopping spike

The minimal in-scope sprite. Init is `RTL`. Main at `Bank0F:2388`:

```
main_bouncing_green_needlenose:
;$0F9116
    LDA  $7D38,x : BEQ +         ; carried? skip cleanup
    LDA  $6FA0,x : ORA #$0600 : STA $6FA0,x  ; OAM front
    LDA  $6FA2,x : AND #$FFE0 : STA $6FA2,x  ; clear OAM-priority subfield
+:
    JSL  CODE_03AF23             ; gravity
    LDA  $6FA2,x : BIT #$001F : BEQ .done    ; sub-priority bits unset -> stop
    JSL  CODE_03A5B7             ; carry-item-transfer check
    LDA  $7860,x : AND #$0001 : BEQ .done    ; not on ground
    LDA.b $18,x : CMP #$0002 : BCS .done     ; hopped 2 times already -> stop
    ASL : TAY
    LDA  DATA_0F9112,y           ; pick hop-velocity (0: $FC00; 1: $FE00)
    STA  !EXRAM_YI_Level_NorSpr_YSpeedLo,x
    LDA.b $18,x : BEQ +          ; on first hop, dim OAM brightness
    LDA  $6FA0,x : AND #$F99F : STA $6FA0,x
    LDA  $6FA2,x : AND #$FFE0 : STA $6FA2,x
+:
    LDA  #!Define_YI_SoundID13_SpringBounce : JSL CODE_push_sound_queue
    INC.b $18,x
.done:
    RTL
```

So a Bouncing Needlenose hops *twice*: first hop is at `$FC00`
upward (~-2.5 px/frame initial Y-vel), second hop is at `$FE00`
(~-2 px/frame). After two hops, the `$18,x` counter saturates at 2
and the sprite stops hopping -- it just sits on the ground from then
on, falling-and-resting as a static spike obstacle. The hop sound is
the generic SpringBounce cue (`SoundID13`), reused for many
spring/jump events.

This is the simplest spike-family sprite by code: ~30 instructions of
Main, no state machine, no SuperFX dispatch. It piggybacks on the
generic carry-item-transfer (`CODE_03A5B7`) and gravity
(`CODE_03AF23`) infrastructure.

---

## 9. Cross-references for the cloud-Lakitu projectile family ($0A2 / $11D)

Sprites `$0A2` (ThunderLakituFireball) and `$11D` (SpinyEgg-alt) are
spawned by sprites in the cloud / Lakitu ecosystem rather than the
spike ecosystem. Their parent spawners + the "fan-out 1+2 chunks"
effect are documented in detail in **`docs/family-clouds.md`**:

- **§6.3 -- Lakitu projectiles ($0A2 / $11D).** Both share the
  needlenose-family Init/Main shell at `Bank0E:6326`. $0A2 forks into
  a specialised Thunder-Lakitu-fireball animation path + 3-chunk fan-
  out on collision. $11D is the Wall-Lakitu spiny projectile.
- **§6.4-6.5 -- Cloud Drop and Lakitu Cloud spawners.** Who throws the
  Thunder Lakitu fireball, when, and how.

This doc (`docs/family-spikes.md`) describes the *shared family Init
and Main body* that both sprites are routed through, plus the
per-Sprite-ID dispatch decisions in `CODE_0EB1D4` and the fan-out
implementation in `CODE_0EB302`. The two docs are complementary: the
cloud doc explains "where does this projectile come from", and the
spike doc explains "what does it do once airborne".

---

## 10. Slot-link conventions across the family

A few non-obvious slot-link patterns surface across the spike family:

**Parent -> child link in `$18,x`.** Spike ($074), Heading Cactus
($0E4), Chained Spike Ball ($10C), and Cactus Jack ($156) all use
`$18,x` to store the slot index of their spawned projectile/segment.
The DEC-then-STY idiom pre-arms `$18 = $FFFF` so a failed spawn
leaves the parent flagged as "no child". Then per-frame the parent
tests `LDY.b $18,x : BMI .no_child` to skip child-related logic.

**Child -> parent link in `!EXRAM_YI_Level_NorSpr_GenericTable701978,y`.**
The reverse direction. When a parent spawns a child, it often stamps
its *own* slot index into the child's `701978` field. The Spike does
this: `TXA : STA  701978,y`. Chain segments (`$10D`) do this for
themselves. This lets a child check if its parent is still alive (and
self-destruct if not, e.g. spike ball state-$08 override).

**The held-by link `$7D36,x` is read but not written by the family.**
All spike-family Main entries READ `$7D36,x` to detect tongue-hold
(needlenose family + Harry Hedgehog), but none WRITE to it. The
engine's tongue handler (Bank06) and egg-stick handler (Bank0A) own
the writes. The family responses on detection:

- **Needlenose family**: force-detach via `CODE_03B25B`, then jump
  back via `JML CODE_03A31E` (despawn).
- **Harry Hedgehog state $02**: force-detach + clear `$7A96` cooldown.
- **Chained Spike Ball + Cactus Jack + Heading Cactus**: similar
  detach pattern.

**Global registry `$0FB7`/`$0FB9`/`$0FBB`.** Unique to Chained Spike
Ball ($10C). The "slot leader" pattern: one global slot index +
palette + segment-count, all level-scope. Each new chain ball
competes for leadership at spawn time. See §5.1 for the contract.

**The "child-identity check" of Heading Cactus.** Unique to $0E4: the
parent's Main checks every frame whether its linked-slot still
contains a `$0E5 GreenNeedlenose` (not just "alive sprite"). If
something else now occupies that slot, the cactus immediately
transitions to state $05 (defeat). This is the only sprite in the
family with a strict child-sprite-ID contract.

---

## 11. Shared infrastructure

### 11.1 StompRt + RideYoshiRt routing

All eleven in-scope sprites (plus the 5-sprite needlenose family
core) share the Bank03 alias chain falling through to
`CODE_head_bop_common` at `Bank03:4304`. The handler runs one Main
frame (so the sprite renders its bop response), applies OAM-front-
priority bits + a `$75E2 = $0400` upward kick to Yoshi. No state
change in the sprite. Yoshi cannot stomp a spiky enemy.

RideYoshiRt is a bare RTL in the terminal alias chain at
`Bank03:3458`. Yoshi cannot stand on these enemies for ride
physics; collision from above without an egg or star damages him
via `CODE_03A858`.

### 11.2 The shared `CODE_03AA52` "egg-on-spikes" cling routine

Several spike-family sprites call `CODE_03AA52` from the top of
their Main entry: Harry Hedgehog ($085, on `$7040 & 1`), Spike Ball
($075, on `$74A2,x` valid), Cactus Jack ($156, unconditional).
Spike ($074) uses the close relative `CODE_03AA2E` (on
`$7722 < 0`). The routine handles the "egg has stuck to my spikes"
hit-cling: when an egg has been physics-bounced into a spike-family
sprite, the egg's `$74A2` slot link is set, and the sprite's Main
runs the routine to translate the stuck egg's animation frame +
apply flicker.

### 11.3 SuperFX renderers used

| FXCODE | Used by | Purpose |
|--------|---------|---------|
| `FXCODE_088205` / `088293` / `088295` / `08835F` | Cactus Jack | Body-and-chain rotate-and-stamp. |
| `FXCODE_08D69F` | Spike Ball | Rotate-and-blit for rolling-ball frames. |
| `FXCODE_08D964` | Harry Hedgehog | Rotate-and-blit during `$7040 & 1` curled phase. |
| `FXCODE_099011` / `09906B` / `09907B` | Cactus Jack | Per-frame intersection test vs other alive sprites (looks for matching `$156` or egg). |
| `FXCODE_0ACDFA` | Chained Spike Ball | Ceiling-distance probe (16-px units). |
| `FXCODE_0ACE2F` | Cactus Jack | Ground / Map16-floor probe at queried X/Y. |
| `FXCODE_0B86B6` | Cactus Jack | Body-segment vertical extension from `$78,x`. |

The spike family does **not** use the `FXCODE_0B8595` arc-velocity
solver that the piranha family uses. The spike family's projectile
launches are done via direct velocity stamping from per-world or
per-direction tables (Heading Cactus `DATA_05E207`/`DATA_05E20B`;
Spike `DATA_04CE21`). The cactus/spike family prefers per-tier
velocity tables over runtime arc computation.

---

## 12. Open questions / unclarities

- **`CODE_0EB1D4` cooldown asymmetry.** The Spiny Egg variants ($099,
  $11D) get a `$7A98 = $0008` cooldown, while Yellow Needlenose
  ($0F9) gets `$0004` (default). Green Needlenose ($0E5) gets neither
  -- it falls into `CODE_0EB23E` (RTS) without spawning a particle.
  The Green-vs-Yellow split is a *behaviour* difference but not
  obvious from the sprite IDs. Verify with runtime trace: do the two
  produce different OAM trails when fired adjacent?
- **Cactus Jack "two-stack" via state $06.** State $06 (`CODE_0EBDA9`)
  appears to spawn another Cactus Jack ($156) as a child. The child's
  `7019D6,y = $0006` is a state-tag. Is the second Cactus Jack
  expected to spawn *on top* of the first one (creating a vertical
  stack), or is this a respawn-after-defeat path? Need a level that
  actually triggers this to confirm.
- **Heading Cactus child-identity check.** Why does the parent test
  for `SpriteID == $0E5 GreenNeedlenose` and not just "alive"? Is
  this a defensive check against the engine's slot-recycling
  semantics, or is there a case in which the slot's sprite-ID
  legitimately changes (e.g. Yoshi eats the pellet and the slot is
  immediately re-allocated to something else)? Verify with eat-cactus-
  pellet runtime test.
- **Chained Spike Ball -- multi-chain placement in same level.** The
  `$0FB7` leader-slot pattern handles multiple chains by picking the
  highest slot as leader. But each $10C's `$18,x` only links to ONE
  segment. What happens with a chain of more than 2 segments?
  Investigation needed -- the answer is likely "each $10D segment
  also has a link to the next segment via the segment's own `$18,y`",
  meaning the chain is a linked list rather than a star.
- **Spike Ball state $08 idle stub.** Reached only via the
  `parent-died` path in Main (`LDY #$04 : STY $76,x` -> state $08 via
  word-stride). It calls `CODE_shy_guy_state_05_stub` which is
  `TYX/RTS`. The ball is left to fall via gravity in this state
  (because `$75E2 = $02CC` was armed just before the transition). So
  state $08 is effectively "I'm a falling ball that doesn't do
  anything"; it'll despawn via the standard offscreen-cleanup. Verify
  by killing parent mid-arc.
- **Bouncing Needlenose hop cap of 2.** Why 2 hops specifically? The
  hop count is hardcoded; `DATA_0F9112` is 2 entries. After 2 hops
  the sprite is effectively static. Is this an intentional
  game-design choice (the sprite is supposed to be a "hop twice then
  settle" enemy), or is there a re-arm path I'm missing? Trace from
  the level header / spawner to see if anyone resets `$18,x`.

---

## 13. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` -- canonical sprite IDs and
  one-line summaries for `$074`, `$075`, `$085`, `$099`, `$0A2`,
  `$0E4`, `$0E5`, `$0F9`, `$10C`, `$11D`, `$156`, `$163`.
- `docs/spritestateengine.md` -- engine-side 9-state dispatcher and
  the shared `CODE_head_bop_common` stub.
- `docs/family-clouds.md` -- parents of the $0A2 ThunderLakitu
  fireball and the $11D Wall-Lakitu Spiny Egg projectile.
- `docs/family-piranhas.md` -- §3 Ptooie and §4 Blow Hard, both
  spawn `$0F9` YellowNeedlenose projectiles; arc-velocity solver
  `FXCODE_0B8595` documented there.
- `docs/leveldataengine.md` -- how sprite-list entries spawn
  spike-family slots in regular levels.
- `yi/Banks/Bank01.asm` -- Harry Hedgehog: `init_hedgehog` (5271),
  `main_hedgehog` (5292), `DATA_01AAE8` (5278), `CODE_01AB13`
  (SuperFX render, 5318), per-state `CODE_01AB6A`/`CODE_01AC06`.
- `yi/Banks/Bank03.asm` -- Init / Main / StompRt / RideYoshiRt
  pointer tables (lines 192-3457), shared `CODE_head_bop_common`
  (4304).
- `yi/Banks/Bank04.asm` -- Spike + Spike Ball: `init_spike` (9684),
  `DATA_spike_state_ptr` (9705), `main_spike` (9711),
  `init_spike_ball` (9921), `DATA_spike_ball_state_ptr` (9933),
  `main_spike_ball` (9940), per-state `CODE_spike_*` /
  `CODE_spike_ball_*` (9760-10119).
- `yi/Banks/Bank05.asm` -- Heading Cactus: `init_heading_cactus`
  (13063), `DATA_heading_cactus_state_ptr` (13094),
  `main_heading_cactus` (13102), per-state handlers
  `CODE_05E179`..`CODE_05E300`.
- `yi/Banks/Bank0D.asm` -- Chained Spike Ball:
  `init_chained_spike_ball` (1336), `DATA_0D8AE7` (1440),
  `main_chained_spike_ball` (1450), helpers `CODE_0D8B3B`
  (ceiling probe), `CODE_0D8B8B` (chain render), `CODE_0D8C4B`
  (player collision), per-state `CODE_0D8CB5`..`CODE_0D8E06`.
- `yi/Banks/Bank0E.asm` -- needlenose family + Cactus Jack:
  `init_needlenose_family` (6400), `main_needlenose_family` (6413),
  `CODE_0EB1D4` (Sprite-ID dispatch), `CODE_0EB27C` (collision),
  `CODE_0EB302` (Thunder fan-out); `init_cactus_jack` (7287),
  `DATA_0EB91E` (state table, 7401), `main_cactus_jack` (7414),
  per-state `CODE_0EBD1E`..`CODE_0EBE6A`.
- `yi/Banks/Bank0F.asm` -- Bouncing Needlenose:
  `init_bouncing_green_needlenose` (2374), `DATA_0F9112` (2381),
  `main_bouncing_green_needlenose` (2388).
- `yi/Memory/SRAM_SpriteSlots.asm` -- the
  `!EXRAM_YI_Level_NorSpr_GenericTable*` aliases for parent/child
  slot links (`701900`/`701902`/`701978`/`7019D6`).
- `yoshisisland-disassembly/disassembly/bank01.asm`,
  `bank04.asm`, `bank05.asm`, `bank0D.asm`, `bank0E.asm`,
  `bank0F.asm` -- Raidenthequick descriptive labels for all
  spike-family bodies (`init_hedgehog`, `init_spike`, `init_spike_ball`,
  `init_heading_cactus`, `init_chained_spike_ball`,
  `init_green_needlenose`, `init_cactus_jack`,
  `init_bouncing_green_needlenose`, plus matching `main_*`
  entries).
- `ys_enmy.asm`, `ys_pa.asm` -- parallel asm files for Heading
  Cactus, Cactus Jack, Spike + Spike Ball, Chained Spike Ball,
  Harry Hedgehog, and the needlenose family core.
