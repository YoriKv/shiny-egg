# YI Cannon / projectile-weapon family reference

Standalone reference for the Yoshi's Island projectile-weapon family --
the firearms of YI's enemy roster. Nine in-scope sprites cover the
whole "shooter + projectile" stack:

- One **walking shooter** (Kaboomba $00A) -- a turtle who carries a
  cannon, cycles aim angles, and fires arcing cannonballs.
- One **rolling/airborne projectile** (Cannonball $00B) and one
  **placed bomb** (Bomb $060) sharing a single Init body but two
  distinct Main bodies.
- Three **stationary blasters** (Red $078 / Yellow $079 / Green $07A)
  -- a single Init + Main + 3-state machine, with the sprite-ID
  offset selecting which Bullet Bill flavor gets spawned.
- Three **Bullet Bill projectile flavors** (Red biting $07B / Yellow
  bouncing $07C / Green tracking $07D) -- straight charger, bouncing
  arcer, and Y-axis homer respectively. Three completely different
  motion models, with one shared "tongued -> morph into Green"
  recovery path.

The thread tying them all together is the **shared explosion ambient
$1ED** spawned by both Cannonball-on-impact and Bomb-on-detonation,
plus the **ID-offset-as-variant-selector** pattern used by both the
blasters (offset selects projectile sprite ID) and the player-side
projectile-flavor dispatch in `CODE_05D43A`.

This doc complements:

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_init`, `spr_state_main`, `spr_state_on_head_bop`,
  `spr_state_on_ride_yoshi`) that runs the per-variant Main bodies
  and routes every Yoshi-bop on a cannon-family sprite to the shared
  `CODE_head_bop_common` stub in Bank03 (Kaboomba excepted -- see
  §2.4 for the alias-block behaviour).
- `docs/family-koopas.md` -- Kaboomba is a walking-cannon Koopa
  reskin; the patrol-walk pattern (X-velocity from a 2-entry
  facing-table, gravity via `CODE_03AF23`) is the same one the
  base Green/Red Koopas use.
- `docs/family-piranhas.md` -- the Ptooie ($09F) uses a near-identical
  "fire a $0F9 needle-ball at Yoshi" pattern; the SuperFX arc-velocity
  solver `FXCODE_0B8595` it uses to compute its projectile arc is the
  same one the Yellow bouncing Bullet Bill ($07C) uses to compute its
  ground-bounce parabola.
- `docs/family-goonies.md` -- the Skeleton Goonie Carrying Bomb ($19F)
  is the only family-external spawner of the $060 Bomb sprite at
  runtime; see §3.3 below.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank03.asm` (Kaboomba walking-cannon body, lines 14880-15206),
`yi/Banks/Bank0E.asm` (Cannonball + Bomb shared init/dispatched mains,
lines 41-239), and `yi/Banks/Bank05.asm` (the three blasters and three
Bullet Bill flavors, lines 11058-12188). Pointer tables (Init / Main /
StompRt / RideYoshiRt) and the shared `CODE_head_bop_common` stub live
in `yi/Banks/Bank03.asm` (lines 86-1102, 2735-2834, and 3116+ for the
RideYoshiRt block). Cross-checked against Raidenthequick's
`bank0[3E5].asm` descriptive labels: `init_kaboomba`, `main_kaboomba`,
`init_cannonball`, `main_cannonball`, `main_bomb`,
`init_bullet_bill_blaster`, `main_bullet_bill_blaster`,
`init_biting_bullet_bill`, `init_bullet_bill`,
`init_bouncing_bullet_bill`, `main_biting_bullet_bill`,
`main_bullet_bill`, `main_bouncing_bullet_bill`. Parallel asm at
`ys_kaboom.asm`, `ys_cannon.asm`, `ys_bullet*.asm`, and `ys_bomb.asm`.

---

## 1. Family at a glance

Nine sprites form the cannon / projectile family. Three categories
(Shooter, Projectile, Blaster) with strong code-sharing within each
category and one strong link between Cannonball and Bomb.

| Sprite ID | Constant name | Bank | Init handler | Main handler | StompRt | Role |
|-----------|---------------|------|--------------|--------------|---------|------|
| `$00A` | `Kaboomba` | 03 | `$03:F2FE` `init_kaboomba` | `$03:F331` `main_kaboomba` | `head_bop_common` | Walking-cannon Koopa. 8-step aim cycle on `$18,x`; 3-state main (aim/fire/cooldown) on `$16,x`. Fires Yoshi-aimed Cannonball ($00B) on Yoshi-shot trigger. |
| `$00B` | `Cannonball` | 0E | `$0E:8002` `init_cannonball` | `$0E:8019` `main_cannonball` | `head_bop_common` | The projectile Kaboomba spawns. Rolling/airborne ground projectile that uses a fall-through into the Bomb main body. On impact spawns ambient explosion $1ED. |
| `$060` | `Bomb` | 0E | `$0E:8002` shared `init_cannonball` | `$0E:8023` `main_bomb` | `head_bop_common` | Stationary fuse-bomb. Shares Init with Cannonball; Main is separate-label but lives at the entry-point Cannonball's Main jumps to after its first frame. On detonation spawns explosion $1ED + damages enemies via $7C16/$7C18 radius check + secondary ambient $1EC puff for splatter. |
| `$078` | `RedBulletBillShooter` | 05 | `$05:D1D7` `init_bullet_bill_blaster` | `$05:D246` `main_bullet_bill_blaster` | `head_bop_common` | Red Bullet Bill Blaster -- cannon mouth at fixed position. 3-state main on `$76,x` (idle/fire/cooldown). ID offset $00 -> spawns $07B Red biting. |
| `$079` | `YellowBulletBillShooter` | 05 | `$05:D1D7` (shared) | `$05:D246` (shared) | `head_bop_common` | Yellow Bullet Bill Blaster. ID offset $01 -> spawns $07C Yellow bouncing. |
| `$07A` | `GreenBulletBillShooter` | 05 | `$05:D1D7` (shared, with extra SuperFX init branch) | `$05:D246` (shared) | `head_bop_common` | Green Bullet Bill Blaster. ID offset $02 -> spawns $07D Green tracking. Only this variant runs `FXCODE_0BBCF8` at init for a line-of-sight probe that picks left/right facing. |
| `$07B` | `RedBulletBill` | 05 | `$05:D661` `init_biting_bullet_bill` | `$05:D665` `main_biting_bullet_bill` | own body, calls `CODE_03AA52` | Red biting Bullet Bill. Charges horizontally; on close approach, opens jaws for $18-frame bite window (`$16,x` timer); palette flips via `$7042 EOR #$000E`. Init falls through to Green init for shared register pre-stamp. |
| `$07C` | `YellowBulletBill` | 05 | `$05:D8DA` `init_bouncing_bullet_bill` | `$05:D8E6` `main_bouncing_bullet_bill` | own body, calls `CODE_03AA52` | Yellow bouncing Bullet Bill. 4-state main on `$76,x` (launch/mid-air/landing/wait). Arcs off the ground via SuperFX `FXCODE_0884A5` zoom on `$7A36`; X/Y velocity recomputed from 16-entry sin-table `DATA_05D9D2`. |
| `$07D` | `GreenBulletBill` | 05 | `$05:D664` `init_bullet_bill` (bare RTL) | `$05:D6ED` `main_bullet_bill` | `head_bop_common` | Green tracking Bullet Bill. **No state machine.** Single Main body that, every 6 frames, EORs `$78,x` palette bit to cycle the 4-frame body palette. Y-speed nudged toward Yoshi via SuperFX `FXCODE_0B86B6` distance probe. |

All Bullet Bill projectiles share `CODE_05D71D` -- a wedge at the top
of each Main that watches `$7D38,x` (tongue-in-progress marker) and,
when set, **morphs the slot to a Green Bullet Bill** in-place
(via `JSL CODE_spawn_sprite` with `#$007D`). So whether Yoshi tongues
a Red biter, a Yellow bouncer, or a Green tracker, the eaten projectile
becomes a Green during the swallow animation. See §5.4 for the morph
mechanics.

The blasters are stationary -- they have no X/Y velocity, just an OAM
slot held at level-data-coordinates. The Kaboomba walks. The
Cannonball rolls on the ground after firing, then becomes airborne
after off-screen-edge or hitting a wall. The Bomb is stationary unless
spawned with kick velocity (which the Skeleton Goonie does).

Stomp behaviour for the family:

- **Kaboomba, Cannonball, Bomb, all three Blasters** all alias to
  the giant `CODE_head_bop_common` block in Bank03 (no per-sprite
  stomp logic). A Yoshi-bop on any of these falls into the bog-
  standard "render once + OAM front-priority fix" path and leaves
  the sprite alive. Cannons aren't stompable as a damage source.
- **Red biting Bullet Bill ($07B) + Yellow bouncing ($07C)** share
  a small private StompRt body at `Bank03:11937` that calls
  `CODE_03AA52` (slot-state freeze guard), then advances the body's
  `$7A38,x` rotation by $0002 (with `AND #$01FE` to keep it
  angle-aligned), then re-runs the SuperFX render (`CODE_05D76A`).
  Effectively a "you stomped but didn't kill -- keep spinning."
- **Green tracking Bullet Bill ($07D)** alone routes to
  `CODE_head_bop_common`. The Green is the only one Yoshi can kill
  directly by jumping on it -- consistent with it being the
  morph-target for swallowed projectiles.

RideYoshiRt for all 9 sprites is a bare RTL in the big alias block in
Bank03; nothing in the family supports being-stood-on.

---

## 2. Kaboomba ($00A) -- the walking-cannon shooter

### 2.1 The aim cycle and the Yoshi-shot trigger

Init at `$03:F2FE` (Bank03.asm:14886):

```
init_kaboomba:
    LDA #$0007 : STA $18,x              ; state $18 = aim index, start at 7
    SEP #$20
    TAY                                  ; Y = 7
    LDA DATA_kaboomba_aim_durations,y
    STA $7A96,x                          ; ($04 frames at idx 7)
    LDA DATA_kaboomba_aim_frames,y
    STA $7402,x                          ; OAM frame = $00 (cannon pointing down)
    TAY
    LDA DATA_03F2D0,y
    STA $7B58,x                          ; Y-offset for OAM stamp (= $08)
    REP #$20
    LDA #$0004 : STA $7BB8,x             ; sprite hitbox W
    LDA #$0004 : STA $7BB6,x             ; sprite hitbox H
    LDY $7400,x
    LDA DATA_03F2FA,y                    ; -$80 or +$80
    STA EXRAM_NorSpr_XSpeedLo,x          ; walk left or right at speed $0080
    RTL
```

The state byte `$18,x` is an **aim index that counts 7-6-5-4-3-2-1-0**,
re-rolling at 0 back to 7. Each value indexes two parallel byte tables:

| Index $18,x | Frame ($7402) | Duration ($7A96) |
|-------------|---------------|------------------|
| 7 | $00 | 4 |
| 6 | $01 | 4 |
| 5 | $02 | 3 |
| 4 | $03 | 2 |
| 3 | $04 | 2 |
| 2 | $05 | 3 |
| 1 | $06 | 4 |
| 0 | $07 | 4 |

The frames are sprite-graphic frames showing the cannon at 8 progressive
elevation angles (frame $07 = barrel highest, frame $00 = barrel
lowest). The duration table is **palindromic** -- the cannon spends 4
frames at the extremes, 2 frames at mid-elevation, so the perceived
"sweep" is even both ways through the arc.

A *second* state byte `$16,x` drives the 3-state Main dispatch via
`DATA_kaboomba_phase_ptr` (`$03:F388`):

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_kaboomba_phase0_aim` (`$03:F39E`) | **Aim cycle.** Decrement `$7A96`; when it hits 0, decrement `$18,x` (next angle), wrap to 7 at -1, re-stamp frame/duration/Y-offset. Check $10 (frame counter) `AND #$003F == 0` (every 64 frames) to detect "Yoshi shot at me" trigger via `CODE_03F531`. If `$76,x = 1` (Yoshi just fired their Yoshi-shot at us), transition to phase 2. |
| `$02` | `CODE_03F422` -- fire sub-state | **Wind-up + fire.** `$18,x` counts 5..0. Per step, stamp duration from `DATA_03F49B` and frame from `DATA_03F495`. At `$18,x == $03`, **spawn the Cannonball** (sprite ID $00B) at Kaboomba's X+offset, Y-$10. Set the cannonball's X-velocity from `DATA_03F4A5` (-$0200 or +$0200 by Kaboomba facing) and Y-velocity from `$FE00` (upward arc). Play `SoundID47_Explosion`. At `$18,x == -1`, advance to phase 4. |
| `$04` | `CODE_03F4A9` -- cooldown | **Cooldown recoil.** `$18,x` re-uses the 5..0 sequence with `DATA_03F495`/`DATA_03F49B`. Stops walking (`STZ XSpeed`) during recoil, then at end re-arms `$18,x = 7` and walk direction, returns to phase 0. |

### 2.2 The "Yoshi-shot" trigger -- a bidirectional aim test

The trigger to fire isn't a timer -- it's a **Yoshi-egg-aimed-at-me
test**. `CODE_03F531` (called every frame inside phase 0) reads
`$76,x`; if it's `1`, it freezes the X-velocity, sets `$18,x = 3`
(wind-up frame), arms duration/frame/Y-offset for the wind-up step,
INCs `$76,x` and stamps `$16,x = 2` (advance to phase 2), then PLA's
the return address to *skip* the rest of phase 0 dispatch.

`$76,x` is set elsewhere -- in `main_kaboomba` itself, on every frame,
the post-dispatch wedge stamps a copy of `$76,x` into
`EXRAM_..GenericTable701902,x`, **clears `$76,x`**, then calls
`CODE_03A5B7` (the engine's "transfer carried item" routine -- the same
one Bandits use to steal eggs). The engine's `CODE_03A5B7` writes
`$76,x = 1` if a Yoshi egg-projectile **hit Kaboomba's sprite hitbox**
this frame. The fire trigger is "I was hit by an egg" -- but instead of
dying (which most enemies do), Kaboomba *responds* by firing back.

The PLA discard-return-address is the standard YI "early-exit-and-skip-
the-caller's-context" idiom -- it pops the return address that
`JSR (DATA_kaboomba_phase_ptr,x)` pushed.

### 2.3 The fired cannonball

The cannonball spawn at `CODE_03F4DE` (Bank03.asm:15138) runs inside
phase-2 step `$18,x == $03`. It loads facing-table offsets, calls
`JSL CODE_spawn_sprite_active` with sprite ID `$000B`, then on success
stamps the child slot's position (Kaboomba.X +/- $10, Y - $10), X-vel
from `DATA_03F4A5` (-$0200 or +$0200), Y-vel **$FE00 (upward 2
pixels/frame)**, and `$7D38,y = 1` (Kaboomba-fired sentinel). Plays
`SoundID47_Explosion`. If the spawn fails (no free slot), plays a
weaker `SoundID42` failed-fire cue.

The cannonball is born with **Y-velocity -$0200**, arcs up, then
gravity (via `CODE_03AF23` in the Cannonball's Main) drops it back
down. The X-velocity is +/-$0200 depending on Kaboomba's facing -- a
single, hard-coded horizontal speed; there's no Yoshi-aim. Kaboomba
fires "forward" along the facing axis, not at the player. The trick
is that **firing only happens when Yoshi shoots Kaboomba** -- so the
player must position themselves to hit Kaboomba while standing in the
cannonball's flight path. The cannonball is *gameplay-paradoxical*:
the way to trigger the fire is to be exactly where the bullet will
land.

Note: `$7D38,y = 1` on the freshly-spawned Cannonball is the
"carrying live payload" flag that the Cannonball's Main reads as its
"I am Kaboomba-spawned" sentinel. The Bomb sprite ($060) when placed
by level data has `$7D38 = 0` -- this is how `main_cannonball`
distinguishes its first-frame airborne behaviour from the Bomb's
ground behaviour. See §3.2.

### 2.4 Kaboomba's stomp + the Yoshi-eats-Kaboomba branch

Kaboomba's StompRt is in the giant alias block at `Bank03:2742`
(falls into `CODE_head_bop_common`). But the post-dispatch wedge in
`main_kaboomba` (Bank03.asm:14918-14956) has its own custom Yoshi-
interaction. When `$7D36,x >= 0` (no slot-link), it stamps the
"egg-hit accumulator" into `$76,x` (the fire trigger described in
§2.2). When `$7D36,x < 0` (held by another sprite -- tongued), it
branches to `CODE_03F35E` which checks the holding-slot's status, the
holding-slot's `$7D38` live-payload flag, and the `$7542,y` (eat-
stage) byte: if `$7542 >= $0040`, force-swallow via `CODE_03B24B`;
else cancel the eat and jump to the same swallow cleanup.

So Kaboomba has a unique "if Yoshi tongues me, force-swallow me even
if the slot would normally bounce out." This is needed because
Kaboomba's hitbox is wider than typical sprites and the engine's
default tongue logic sometimes spits him back out. The
`CODE_03B24B` body is the "ate-a-shy-guy-style" eater that frees the
slot directly.

---

## 3. Cannonball ($00B) + Bomb ($060) -- shared Init, branched Main

### 3.1 The shared Init body

A direct implementation of the "two distinct sprites at one Init"
pattern (Bank0E.asm:44-58). Both `YI_NorSpr00B_Cannonball_Init` and
`YI_NorSpr060_Bomb_Init` fall into `init_cannonball`, which randomizes
`$16,x = $30 + (frame_counter & $1F)` (fuse-length of 48-79 frames),
sets `$7863 = $7F` (collision-tag for "explosion-radius-on-impact"),
INCs `$78,x` (settled-state marker), and RTLs. No variant divergence.

### 3.2 The two distinct Main bodies (with shared body)

Bank0E.asm:65-200. The Cannonball entry-point at `main_cannonball`
runs a 2-line wedge that distinguishes "fresh Kaboomba-fired bullet"
from "settled bomb":

```
YI_NorSpr00B_Cannonball_Main:
main_cannonball:
;$0E8019
    LDY $7D38,x : BEQ CODE_main_bomb     ; if not Kaboomba-fired, fall into Bomb main
    LDY $7D36,x : BMI CODE_0E809E        ; if held by tongue/other, JMP to detonate

YI_NorSpr060_Bomb_Main:
CODE_main_bomb:
CODE_0E8023:
    JSL CODE_03AF23                       ; standard gravity/anim
    LDY $76,x : BEQ CODE_0E802F
    JSR CODE_0E814D                       ; post-detonation cleanup (animate the puff)
    RTL
```

The wedge is the key trick: a Cannonball with `$7D38 = 1` (the
Kaboomba-set flag, see §2.3) takes a **different first frame** than a
sitting Bomb. The Cannonball flag wedge looks like:

- If `$7D38 = 1` (live payload from Kaboomba) **and** `$7D36 < 0`
  (slot is currently held by another sprite -- tongued), **immediately
  detonate** by jumping to `CODE_0E809E` (the explosion-spawn body).
  So tonguing a flying cannonball blows it up in Yoshi's mouth.
- If `$7D38 = 0` (a placed Bomb, level-data sprite-list entry), fall
  through to the shared Bomb main body. The bomb proceeds normally
  through its fuse countdown.

After the wedge, both Cannonball and Bomb share the same
`CODE_main_bomb` body which:

1. Applies standard sprite gravity / animation update (`CODE_03AF23`).
2. Reads `$76,x` (the post-detonation flag). If non-zero, the bomb
   has *already* detonated and this frame is just animating the
   ambient puff via `CODE_0E814D`. RTL after one frame.
3. Otherwise, runs the **floor-collision + Cannonball-impact** branch
   (`CODE_0E802F`):
    - If `$18,x != 0` (linked-explosion -- the Bomb has a "trigger
      slot" via $18,x), check linked slot's status; if alive ($0010),
      ignore self-detonate (defer to caller); else detonate.
    - If `$7D36 < 0` (held by some other slot's tongue), detonate.
    - Sample collision bits `$7860 & $002F` (ground or wall) -- on
      contact, set `$78,x = 1` (settled flag); if `$7862 != 0` (still
      bouncing), decrement `$16,x` fuse and on underflow detonate.

The actual **detonation block** at `CODE_0E809E` (Bank0E.asm:142-162)
spawns the explosion ambient `$1ED` (copying X/Y position from
`$7CD6/$7CD8` to the ambient slot's `$70A2/$7142`), stamps lifetime
`$73C2 = $000D` (13 frames) and pace `$7782 = $0003` (3-frame
stride), queues `SoundID47_Explosion`, freezes the sprite (XSpeed/
YSpeed/`$7542` cleared, `$7D38` live-payload flag cleared), shifts
OAM priority to `$68A0` (background palette for the puff visual),
INCs `$76,x` to flag "post-detonation."

After detonation, the sprite **isn't despawned immediately** -- the
*next* frame runs `CODE_0E814D` (the "shrink and clean up" body)
which counts `$7A36,x += 4` from 0 to $10 and then calls
`CODE_03A31E` to free the slot. Effectively a 4-frame post-detonation
lifetime.

### 3.3 Where Bombs come from

The Bomb sprite ($060) is spawned by exactly **three** code sites
across the whole game:

| Source | Spawn site | Notes |
|--------|-----------|-------|
| Level data | sprite-list entry with ID $060 | Stationary fuse-bomb level decoration. Runs full Init/Main with `$7D38 = 0`. |
| Skeleton Goonie ($19F) | `init_skeleton_goonie_with_bomb` (`Bank0C.asm:4019`) | The Goonie spawns its Bomb cargo at init; the Bomb gets `$7019D8 = 1` (carried-by-Goonie flag) and stalls fuse-decrement while the Goonie is alive. |
| Baron Von Zeppelin ($175) | BVZ payload table `DATA_bvz_payload_sprite_ids[$02]` = `#!Define_YI_NorSpr060_Bomb` (`Bank07.asm:14981`) | $175 is the BVZ-with-Bomb variant; on drop, runs the drop handler `CODE_07F808` which spawns a Bomb at drop coordinates. |

The Cannonball sprite ($00B) is spawned by exactly **one** code site:
Kaboomba's phase-2 fire (`Bank03.asm:15149`). There are no level-data
entries for Cannonball -- it's always Kaboomba-spawned. So the
"$7D38 = 1" wedge in `main_cannonball` is a reliable distinguisher of
"this came from Kaboomba" vs "this is a placed Bomb."

### 3.4 The radius-damage check

The Bomb's secondary effect on detonation isn't just the visual puff
-- it also damages nearby enemies. `CODE_0E80DD` (lines 166-200) is
the "fire splatter" body, run only for Bomb ($060) sprites (not
Cannonball -- the wedge filters via
`CMP #!Define_YI_NorSpr00B_Cannonball / BEQ`). On every other
detonation frame (`$0030 & 1` = frame-counter parity), a fresh
ambient `$1EC` puff is spawned with random offsets `-10..-7` on both
axes (from `$10` frame-counter shuffled via PHA / AND / SBC and
XBA / AND / SBC).

So a detonating Cannonball is a single puff; a detonating Bomb is a
multi-puff cloud lasting several frames. This is the visual
distinction between the two -- both share Init, both share Main body,
but the splatter-spawn branch is the one branch that diverges.

### 3.5 The post-detonation animate body

`CODE_0E814D` (Bank0E.asm:209-262) handles the cleanup phase. It
animates the puff position via two interleaved 8-entry direction tables
`DATA_0E8129` / `DATA_0E8139` (each row a `dw $0010,$FFF0,...` 8-entry
2D offset selector), uses SuperFX `FXCODE_0ACE2F` to probe the spread-
cell, and despawns the slot via `CODE_03A31E` once `$7A36 >= $0010`.
The body also conditionally calls `CODE_03A858` if the bomb is within
a $30 x $30 box of certain other game-state markers -- this is the
"propagate detonation to chained bombs" path. A chained bomb-cluster
can cascade.

---

## 4. Bullet Bill Blasters ($078 / $079 / $07A) -- shared 3-state machine

### 4.1 Shared Init with one variant-specific branch

Bank05.asm:11069-11115. Init:

1. Stamps initial cannon zoom `$7A36 = $0100`.
2. Computes `(SpriteID - $078) * 2` -> `Y = 0/2/4`, stores in `$18,x`
   as variant index, uses Y to look up OAM frame from `DATA_05D1D1`
   (`$0022/$0024/$0020` for Red/Yellow/Green).
3. **Green-only branch (`CPY #$02`):** runs `CODE_03AE60` (cannon-setup
   helper), `CODE_05D32B` (SuperFX render-prep), then stamps R1/R2
   with screen position and invokes `FXCODE_0BBCF8` (the line-of-sight
   probe). The result lands in R0, which the code stores into
   `EXRAM_..GenericTable701902,x`; the same value, after `SBC #$0080`,
   gates the `$7400,x` facing direction (0 = close/right, 2 = far/left).
4. Stamps `$FFFF` sentinel into `GenericTable701900,x` ("no projectile
   spawned yet"), `$19,x = 0`.

The ID-offset trick is two-stage:

1. `(SpriteID - $078) * 2` = a word-aligned variant index in `$18,x`
   that's used both as an OAM-frame selector (the cannon faces look
   slightly different per color) and as a *spawn-time projectile-ID
   selector* in `CODE_05D602` (see §4.3 below).
2. **Only Green** (`CPY #$02`) runs an additional SuperFX probe
   `FXCODE_0BBCF8` at init -- this is the line-of-sight test that
   stamps the cannon's facing direction (`$7400,x`) based on whether
   Yoshi's last-known X is to the left or right. Red and Yellow
   blasters face whichever way the level data placed them
   (`$7400` defaulted by the engine); Green re-points itself at
   Yoshi at level-load.

The Green-only init branch is the only place in the family where
$07A acts different from its peers -- the runtime Main treats all
three identically.

### 4.2 The 3-state Main machine

State dispatch at `DATA_bullet_bill_blaster_state_ptr` (`$05:D238`):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_05D4FA` | **Idle, watch fire window.** Two sub-paths driven by `$18,x` (variant index): Green (`$18 == 2`) runs `CODE_sprite_player_delta_facing #$0004` to flip facing toward Yoshi every 4 frames; Red/Yellow stamp facing from `$77C2,x` (Yoshi-direction) and look up an X-direction-offset from `DATA_05D4F6`. Then watches `$7A98 = 0` + the on-screen-edge gate (X past $0110 = off-screen suppression), and when ready calls `CODE_05D602` (the spawn-projectile body). On successful spawn, arms `$7A36 = $0174` (the fire animation length) and advances to state $01. |
| `$01` | `CODE_05D577` | **Fire animation.** Counts `$7A36,x` up by $0004/frame from $0174 to $01FF. On overflow, transitions: stamps `$16,x = 2` (cooldown sub-state index), `$78,x = $0102` (cooldown ping-pong selector), `$76,x = $0202` (state byte + extra hi byte). The hi-byte $02 is a one-shot direction-flip marker consumed in state $02. |
| `$02` | `CODE_05D5A1` | **Post-fire cooldown / barrel-swing.** Reads `$78,x` ($0102 starting), looks up `DATA_05D599 = $0010 / $FFF0` (alternating X-deltas), and bumps `$7A36,x` accordingly each frame. The barrel "swings" between zoom $0199 and $01FF. Each pass: if `$7A36 >= $01FF`, swap `$78` to next direction (`EOR #$0002`) and stamp `$77,x = 2`. If `< $0199`, swap again and decrement `$16,x` (cooldown counter). When `$16,x` underflows, transitions: based on `$18,x` variant (Green = 0 cooldown, Red/Yellow = 2 -> +2 cooldown), arms `$7A98,x = $0100` (idle wait time), `$7A36 = $0100`, `$76 = $00`. |

### 4.3 The variant-selector spawn body

`CODE_05D602` (Bank05.asm:11581) decides which flavor of Bullet Bill
to spawn. For Green, an extra gate fires only if the LOS-probe result
(`GenericTable701900,x & $00FF >= $0080` -- Yoshi is in the "far"
half of the screen). For all variants, the spawn ID is computed as
`($18 >> 1) + $7B`:

| Blaster `$18,x` | Projectile-ID computation | Spawned sprite |
|-----------------|---------------------------|----------------|
| 0 (Red blaster $078) | `0 + $7B` = `$7B` | RedBulletBill |
| 2 (Yellow blaster $079) | `1 + $7B` = `$7C` | YellowBulletBill |
| 4 (Green blaster $07A) | `2 + $7B` = `$7D` | GreenBulletBill |

After spawning, the body calls `JSL CODE_03A34E` to grab a free slot,
then on success copies the blaster's X/Y/$7042 into the child and
stamps `$7863 = $FF` (no-further-fires tag on the parent slot until
the projectile despawns).

After spawning, the Blaster's main entry continues with **post-spawn
flag maintenance** (Bank05.asm:11168-11186). If the spawned variant is
$07C (Yellow), the blaster keeps the spawn-slot reference alive (will
auto-clear if the Yellow despawns from off-screen or wall-hit). For
Red ($07B) and Green ($07D), the reference is cleared immediately
(the blaster fires-and-forgets).

### 4.4 The shared SuperFX render

`CODE_05D32B` (Bank05.asm:11241) is the per-frame SuperFX render
that draws the cannon-barrel sprite. It passes the variant index
`$77,x` (via the FX-data offset table `DATA_05D325`), the body's
zoom `$7A36`, and the angle `$7A38` into `FXCODE_08D6EB` (the
cannon-barrel-zoom-rotate renderer). All three blasters use this
same FX routine -- the visual difference is only the OAM palette and
the FX-data offset (different cannon shape pre-stamped).

### 4.5 Static spawn cap via $0CF9

The SuperFX render also `INC $0CF9` after invocation -- this is the
**static-sprite-count** budget. The engine throttles the cannon
renders if too many are visible simultaneously. There's no per-slot
ammo cap on blasters; they fire as fast as their internal cooldowns
allow indefinitely.

---

## 5. Bullet Bill projectiles ($07B / $07C / $07D)

Three completely different motion models, all spawned by the shared
blasters. The Red biting and Green tracking variants share an Init
fall-through; the Yellow bouncing has its own Init.

### 5.1 Red biting Bullet Bill ($07B) -- the 3-state biter

Init at `Bank05.asm:11641` is a clean shared-Init fall-through. Red
runs `JSR CODE_05D77F` (the SuperFX-register pre-stamp that sets
`R12/R13/R5/R6/R3/R2` for the FX render routine and INCs the static-
sprite count slot `$0CF9`), then falls into the Green init label
which is a bare RTL.

Main at `$05:D665` is a small machine driven by `$76,x` + `$16,x`:

| `$76,x` | Role |
|---------|------|
| `$00` | **Charge.** Waits for `$7A98 = 0` (in-flight cooldown), then advances. |
| `$01` | **Bite window.** `$16,x` counts down a $18-frame bite-attempt window. Each frame: EOR `$7042` with `$000E` (3-bit palette cycle -- the open/close jaw animation), subtract $0004 from `$7A36` (zoom-out clamped at $0040). On window expiry, advances to state $02. |
| `$02` | **Despawn.** Spawns ambient $1CD (small puff) at position, plays a $0B-frame stride-4 fade, jumps to `CODE_03A31E` (free slot). |

The bite window is the "open jaws" visual at close range -- Red is
the only Bullet Bill that doesn't fly through Yoshi; it actually
*opens its mouth* and tries to swallow Yoshi if the bite-window
catches him. Outside the window, Red is just a fast horizontal
charger. The `$7A36 -= $0004` zoom decay means the open-jaws
animation visually shrinks the bullet over the bite window.

### 5.2 Yellow bouncing Bullet Bill ($07C) -- the 4-state bouncer

Init at `Bank05.asm:11967` just calls `CODE_05D923` (the SuperFX-render
register pre-stamp for `FXCODE_0884A5` -- the arc renderer) and RTLs.

Main at `$05:D8E6` runs a 4-state dispatcher via
`DATA_bouncing_bullet_bill_state_ptr`:

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_05D962` | **Launch.** Stamp `$78,x = $0100` (frame counter), `$7A36 = $0100` (initial zoom). Call `CODE_05D96F` (the floor-test-and-bounce body): on floor contact, read collision-cell from `DATA_058F48-$01[$7860 & $0F]` (a 14-entry slope-deflection LUT), pick a `$16,x` deflection index (4/5/6/7/8 depending on slope steepness), stamp `$18,x = AngleOfStoodOnGround & $FF`, freeze velocity, advance to state $01. Otherwise stash current velocity into `GenericTable701900/701902` for next-frame replay. |
| `$01` | `CODE_05D9F2` | **Mid-air bounce.** This is the arc. Subtract $0008 from `$7A36`; if >= $00A0 (still above peak), compute new velocity: index `DATA_05D9D2` (a 16-entry sin/cos pair table) by `$16,x` (deflection idx) + `$0010` if `$7400 != 0`, sign-flip if right-facing. Then call SuperFX `FXCODE_0B8595` (the **arc-velocity solver**) with the picked velocity and `R6 = $0166` apex; the FX writes the new X/Y velocity into `R0/R1` which stamp into `EXRAM_..XSpeed/YSpeedLo,x`. Advance to state $02. |
| `$02` | `CODE_05DA6A` | **Landing.** Call `CODE_05D96F` again (floor-test). If still in-air, increment `$7A36` by $0008 toward $0130 (descending arc). On hit floor (state $76 = $03), zoom $0130 reached. |
| `$03` | `CODE_05DA81` | **Wait at ground.** Decrement `$7A36` by $0004 down to $0100, then resets state $76 to $00 for next bounce. |

The bounce uses the same SuperFX `FXCODE_0B8595` arc-solver that the
Ptooie's spit uses (see `docs/family-piranhas.md` §3) -- both compute
"given X-velocity-target, what Y-velocity will I have at apex?" The
apex multiplier `R6 = $0166` is the Yellow's tunable: it's lower than
Ptooie's $FA00, so Yellow bounces shorter arcs.

### 5.3 Green tracking Bullet Bill ($07D) -- the no-state homer

Main at `$05:D6ED` has **no state machine**. Green just runs its
tracking loop every frame:

1. Run the tongued-morph wedge `CODE_05D71D` (see §5.4).
2. Apply standard gravity (`CODE_03AF23`).
3. Lock OAM priority to $0004 (in-front-of-tiles).
4. Stamp zoom `$7A36` into both `R4` and `R9` registers, call
   `CODE_05D7BB` -- the Y-tracking SuperFX probe.
5. Every 6 frames, `EOR $78,x #$0002` to toggle a low palette bit
   (12-frame ping-pong = the visible green-blinking).

`CODE_05D7BB` (Bank05.asm:11818) is the heart of the homing. It
probes two distance thresholds (`R6 = $000C` and `R6 = $0006` -- with
R4/R9 carrying the zoom) against Yoshi's Y-distance via
`FXCODE_0B86B6`. On the close-distance probe, if Yoshi is within
`$7C18 - $02 >= $FFF8` and Yoshi has carry-egg ($60AB negative), it
applies the "Yoshi-eaten-by-bullet" cinema: `$60AA = $FA00` (Yoshi
Y-velocity = -$0600 = knockback), `$60C0 = $0006`, `$60D2 = $8001`,
plays SoundID0B (`ShellHit1`). On the wider-distance probe (no
eat-cinema), it clears `$60AA / $60D2` and calls `CODE_03A858` to
**drag Yoshi toward the Bullet Bill's Y**.

Effectively the Green sprite drags Yoshi vertically so Yoshi is
"stuck on the bullet's altitude" -- the Bullet Bill itself doesn't
change Y-speed; it pushes the player toward its current Y. A bizarre
inversion of usual "homing" logic.

### 5.4 The tongued-to-Green morph

`CODE_05D71D` (Bank05.asm:11743) is called from all 3 Bullet Bill
Mains as the very first instruction. When `$7D38,x = 0` (not tongued),
it's a bare RTS. When `$7D38 != 0`, it:

1. Optionally freezes gravity via `CODE_03AEFD` (if `$7722,x` is non-
   negative -- meaning slot is alive).
2. Stashes current X-speed, Y-speed, and OAM frame `$7042` on the
   stack.
3. `JSL CODE_spawn_sprite` with `#!Define_YI_NorSpr07D_GreenBulletBill`
   on the slot's own X register -- this is the engine-wide "morph the
   slot's sprite-ID in place" pattern.
4. Restamps `$75E0` from `DATA_05D719[$7400]` (new X-speed table),
   OAM tint `$7542 = $7540 = $0040`, priority `$6FA0 = $6820`.
5. Pops back the saved speed/frame values so the *visible* motion
   stays continuous across the morph.

This is the same engine-wide "slot-morph" pattern used elsewhere (e.g.,
the Bandit-from-bucket spawn in Bank05). After the morph, the slot
runs the Green's Main on its next frame and beyond -- so a Red
projectile that gets tongued just before reaching Yoshi will appear
visually swallowed as a Green (the in-mouth animation flips palette
to green).

This is a clever code-share trick: the Yoshi-eats-Bullet-Bill cinematic
only needs to be implemented for one variant, and the Red/Yellow
variants morph into it on contact.

---

## 6. Shared explosion ambient $1ED

`!Define_YI_AmbSpr1ED = $01ED` is the ambient-sprite handler used by
**both** the Cannonball impact and the Bomb detonation. Its handler is
`CODE_009548` in Bank00 (line 2904): a stride-3 timer that decrements
`$73C2,x` every 3 frames and despawns on underflow. With the spawn-
site stamping `$73C2,y = $000D` and `$7782,y = $0003`, the explosion
puff lives for 13 * 3 = 39 frames.

Note: the ambient-sprite IDs file (`yi/Constants/AmbientSpriteIDs.asm`
line 102) labels $1ED as "Bamboo Dancers dance end". This is a
**naming inheritance from an earlier identification pass** -- the
ambient handler routine `CODE_009548` is *generic* (a stride-3
countdown despawn) and gets re-used by anything that wants that
lifetime shape. The runtime use across the codebase is exclusively
the Cannonball/Bomb explosion (single call site at `Bank0E.asm:143`).
The "Bamboo Dancers" label likely came from analyzing the sprite-
slot's OAM/tile association rather than runtime callers. Treat the
$1ED purpose as **explosion ambient puff** for cannon-family work.

The companion $1EC ambient (`Bank0E.asm:187`) is the Bomb-only
"splatter" puff spawned per detonation frame with random offset
(see §3.4). Its handler is `CODE_009519` (stride-1 simple countdown)
-- a much shorter-lived puff than $1ED.

Both ambients share the canonical YI puff-spawn pattern: load the
ambient ID into A, `JSL CODE_spawn_ambient_sprite` (returns slot in Y),
copy `$7CD6,x` and `$7CD8,x` (or `$7182,x`) into the ambient's
`$70A2,y` / `$7142,y`, stamp `$73C2,y` lifetime + `$7782,y` pace.

Within the cannon family, the only explosion-spawn sites are the
single Cannonball/Bomb detonation block at `CODE_0E809E` (for $1ED)
and the per-frame splatter loop at `CODE_0E80DD` (for $1EC). No other
family member spawns $1ED.

---

## 7. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` -- canonical sprite IDs and one-
  line summaries for `$00A` (Kaboomba), `$00B` (Cannonball), `$060`
  (Bomb), `$078`/`$079`/`$07A` (Blasters), `$07B`/`$07C`/`$07D`
  (Bullet Bills).
- `yi/Constants/AmbientSpriteIDs.asm` -- `$1ED` (explosion puff;
  misleadingly labeled "Bamboo Dancers dance end" -- see §6),
  `$1EC` (Bomb splatter puff), `$1CD` (Red biting Bullet Bill despawn
  puff).
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  that runs each variant's Main and routes Yoshi-bops to the shared
  `CODE_head_bop_common` stub (or to the bullet-bill-private
  StompRt at Bank03:11937).
- `docs/family-koopas.md` -- Kaboomba is a Koopa walking-shooter
  variant; uses the same patrol-walk velocity model as Green Koopa.
- `docs/family-piranhas.md` -- Ptooie ($09F) uses the same SuperFX
  arc-velocity solver `FXCODE_0B8595` as Yellow Bullet Bill ($07C).
- `docs/family-goonies.md` -- Skeleton Goonie Carrying Bomb ($19F)
  is the only family-external spawner of $060 Bomb at runtime
  (level-data + Baron Von Zeppelin being the other two).
- `docs/family-shyguys.md` -- Snifit ($113) is structurally similar
  (3-state shooter spawning projectile $114) but isn't a cannon-family
  sprite. The pattern however is identical.
- `yi/Banks/Bank03.asm` -- Kaboomba bodies + tables: `init_kaboomba`
  (14886), `main_kaboomba` (14912), `DATA_kaboomba_phase_ptr` (14959),
  `DATA_kaboomba_aim_frames` / `aim_durations` (14965-14970),
  `CODE_kaboomba_phase0_aim` (14973), `CODE_03F422`/`CODE_03F4A9`
  fire/cooldown bodies (15042/15113), spawn-cannonball site (15138).
  Also: shared StompRt/RideYoshiRt alias tables and bodies
  (`head_bop_common` at line 4303 of Bank03 — see family-piranhas.md
  for the alias-block convention).
- `yi/Banks/Bank0E.asm` -- Cannonball + Bomb shared Init at line 44
  (`init_cannonball`), Cannonball Main wedge at line 65
  (`main_cannonball`), Bomb Main at line 75 (`main_bomb`),
  detonation block at line 142 (`CODE_0E809E`), post-detonation animate
  body at line 209 (`CODE_0E814D`).
- `yi/Banks/Bank05.asm` -- Bullet Bill Blasters: Init at line 11069
  (`init_bullet_bill_blaster`), state-ptr table at 11119, Main at
  line 11131 (`main_bullet_bill_blaster`), 3 sub-state bodies at
  11444 / 11506 / 11530. Bullet Bill projectiles: Red Init at line
  11641, Red/Green Init fall-through at 11645, Red Main at 11651,
  Green Main at 11718, tongued-morph at 11743 (`CODE_05D71D`),
  Yellow Init at 11967, Yellow state-ptr at 11975, Yellow Main at
  11982, 4 sub-state bodies at 12037 / 12102 / 12164 / 12177.
- `yi/Banks/Bank0C.asm` -- Skeleton Goonie Carrying Bomb at line
  3996 (`init_skeleton_goonie_with_bomb`), spawn-Bomb at line 4019,
  Bomb-link cleanup at line 4234/4254.
- `yi/Banks/Bank07.asm` -- Baron Von Zeppelin payload table at line
  14977 (`DATA_bvz_payload_sprite_ids`), Bomb at index 2; drop
  handlers at 14993 (`DATA_bvz_payload_drop_ptr`); $060 spawn site
  at `CODE_07F808`.
- `yoshisisland-disassembly/disassembly/bank03.asm` -- Raidenthequick's
  descriptive labels: `init_kaboomba`, `main_kaboomba`.
- `yoshisisland-disassembly/disassembly/bank0E.asm` --
  `init_cannonball`, `main_cannonball`, `main_bomb`.
- `yoshisisland-disassembly/disassembly/bank05.asm` --
  `init_bullet_bill_blaster`, `main_bullet_bill_blaster`,
  `init_biting_bullet_bill`, `init_bullet_bill`,
  `init_bouncing_bullet_bill`, `main_biting_bullet_bill`,
  `main_bullet_bill`, `main_bouncing_bullet_bill`.
- `ys_kaboom.asm`, `ys_cannon.asm`, `ys_bullet*.asm`, `ys_bomb.asm` --
  parallel asm sources covering the same family. `ys_bullet*.asm`
  is split into multiple files for the three flavors. `ys_bomb.asm`
  has the Bomb's per-state body separate from `ys_cannon.asm` (which
  has the Cannonball-specific wedge) -- mirrors the structural
  split YI ROM-side uses (one shared Init, two separate Mains).

---

## 8. Open questions / unclarities

- **AmbSpr1ED purpose label.** The constant comment in
  `yi/Constants/AmbientSpriteIDs.asm:102` reads "Bamboo Dancers dance
  end", but the only runtime spawn-site is `Bank0E.asm:143` (Cannonball
  / Bomb detonation). Either the AmbSpr1ED handler `CODE_009548` was
  originally written for Bamboo Dancers and re-used as a generic
  stride-3 timer that the explosion borrows, or the constant comment
  is stale and should read "explosion puff / Bamboo Dancers timer
  (shared)". Worth a clarifying edit to the constants file.

- **Kaboomba's `$76,x` "Yoshi-shot trigger" timing.** The
  `CODE_03A5B7` call in main_kaboomba writes `$76,x = 1` when an
  egg-projectile overlaps Kaboomba's hitbox. But the post-dispatch
  wedge at line 14918-14934 reads the **pre-clear** value (via
  GenericTable701902), then INCs and stamps back. The double-stash
  through EXRAM is unusual. Hypothesis: there's a single-frame
  delay between "egg hit me" and "I respond by firing" so the egg
  graphic is visible at impact; could be verified by frame-by-frame
  trace.

- **Bomb-chain propagation via `CODE_0E814D` SuperFX FXCODE_0ACE2F
  probe.** The post-detonation cleanup body probes a $30 x $30 box
  around the bomb and conditionally `JSL CODE_03A858`s. The
  hypothesis is "trigger nearby chained bombs," but the actual
  game-data placement of multi-bomb clusters is rare. Verify with
  a level-data scan for adjacent $060 sprites and observe
  cascade-detonation behavior in BizHawk.

- **Yellow Bullet Bill state $03 (wait) loop.** State $76,x = $03
  decrements `$7A36` from $0100 to ... $0100 (the `CMP #$0100 / BPL`
  branch). So the wait state actually keeps `$7A36` at $0100 and
  immediately wraps to state $00 the next frame. Is state $03
  effectively a 1-frame stutter, or does the wrap-on-`$BPL` mean it
  takes multiple frames? Inspect the SBC math: $0100 - $0004 = $00FC,
  CMP #$0100 -> N=1 (negative), BPL skip taken, so $76 stays $03.
  Actually does this mean the wait is potentially indefinite if
  `$7A36` never exceeds $0100? Worth a single-step trace.

- **Green blaster $07A's `FXCODE_0BBCF8` probe semantics.** The
  init-time probe writes `R0` -> EXRAM_..GenericTable701902,x; the
  spawn-gate then checks `(701900,x & $00FF) >= $0080`. But `701900`
  and `701902` are different slot fields. Either there's an aliasing
  trick (701900-byte-low and 701902-word-high) or the gate is
  reading a stale value from a different code path. Confirm by
  tracing exactly which EXRAM offset the FX result is being stored
  to vs read from -- the .asm line 11099 writes 701902, the gate
  at line 11585 reads 701900. There may be a bug here: Green's LOS
  probe result might not actually gate Green's fire. Possible
  candidate for a runtime trace + fix.

- **The Red Bullet Bill bite window with tongued-morph.** If Yoshi
  tongues a Red ($07B) during its open-jaws state $01, `CODE_05D71D`
  morphs the slot to Green ($07D) *before* the state-machine
  dispatch. So the bite-window animation gets cancelled mid-frame.
  Visually this could be jarring (red-blinking palette suddenly
  becomes green) -- but in practice tongueing happens fast and the
  morph is one-frame. Verify the morph preserves OAM continuity
  (does the Red graphic linger for one extra frame?).

- **Cannonball + tongued behaviour.** `main_cannonball` wedge checks
  `$7D38 = 1` (Kaboomba-fired) AND `$7D36 < 0` (tongued) -> immediate
  detonation. So tonguing a flying Cannonball blows it up. But what
  about tonguing a placed Bomb? The Bomb's `$7D38 = 0` so the wedge
  falls into Bomb's Main, then the inner `$7D36 < 0` check at line
  93 should also detonate it. Verify: a tongued placed-Bomb should
  blow up in Yoshi's mouth (a damage source against Yoshi himself).
  Worth a runtime test in a Bomb-heavy level.
