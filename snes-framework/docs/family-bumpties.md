# YI Bumpty family reference

Standalone reference for the Yoshi's Island Bumpty (penguin) sprite
family -- the round white birds with red feet that appear in the
World-5 snow / ice stages. Three sprites share a "penguin" body and
shared on-contact dynamics, but use three completely independent state
machines and three independent Main entry points. They are not as
tightly fused as e.g. the Bandit family (one body, several entries) --
each Bumpty variant is its own implementation.

Companion to:

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_init`, `spr_state_main`, `spr_state_on_head_bop`, etc.)
  that runs the per-variant `init_bumpty*` / `main_bumpty*` bodies and
  routes Yoshi-bop into the shared `head_bop_common` stub.

Source of truth: `yi/Banks/Bank0C.asm` lines 2528-3702 (all three
Bumpty bodies + the shared collision helper); `yi/Banks/Bank03.asm`
for the pointer-table entries, RideYoshiRt RTL-stubs, and the
`head_bop_common` body; `yi/Banks/Bank06.asm:7042` for the baby-Mario
ejection helper `CODE_06BE72` shared with several other contact-
hazardous enemies; `yi/Banks/Bank06.asm:7368` for the Bumpty branch in
the baby-return dispatcher `CODE_06C114`. Cross-checked against
`yoshisisland-disassembly/disassembly/bank0C.asm` descriptive labels
`init_bumpty`, `main_bumpty`, `init_bumpty_tackling`,
`main_bumpty_tackling`, `init_bumpty_flying`, `main_bumpty_flying`.

---

## 1. Family at a glance

| Sprite ID | Constant name | Init | Main | StompRt | Role |
|-----------|---------------|------|------|---------|------|
| `$184` | `Bumpty` | `$0C:9306` `init_bumpty` | `$0C:930E` `main_bumpty` | `head_bop_common` (no-kill) | Walking penguin. 4-state main (walk / collide-recover / bumped / despawn). Alternates facing on a $7AF6 cycle; chooses slide vs bounce on floor-hit depending on speed band. |
| `$19B` | `TacklingBumpty` | `$0C:970A` `init_bumpty_tackling` | `$0C:971D` `main_bumpty_tackling` | `head_bop_common` (no-kill) | Bumpty that builds speed, launches into a spinning "tackle" leap with Y=$FE00, then tumble-skids using the per-speed-band animation tables `DATA_0C9836`/`DATA_0C983D`. 6-state main. |
| `$19C` | `FlyingBumpty` | `$0C:99B5` `init_bumpty_flying` | `$0C:9A13` `main_bumpty_flying` | `head_bop_common` (no-kill) | Hovering Bumpty that oscillates Y around its spawn point via the anim-table picker `DATA_0C9ADF`. On player-stomp morphs in-slot into a $184 Bumpty (single-line `JML CODE_spawn_sprite`). 2-state main (hover / dive). |

All three sprites share two important engine-level traits:

- **Stomp doesn't kill.** All three `_StompRt` entries in Bank03 fall
  into the shared `head_bop_common` body (`Bank03.asm:4303`), which
  just runs `spr_state_main` once, sets the OAM front-priority bits,
  and arms a Yoshi-side $0400 vertical kick at `$75E2`. None of them
  transition the sprite to die-state $0C. In-game this is the "you
  can't stomp Bumpties" rule -- jumping on a Bumpty bounces Yoshi
  upward but the penguin keeps walking.
- **Side-contact ejects baby Mario.** When Yoshi's hitbox overlaps a
  Bumpty horizontally (not from above), each variant routes through
  its own per-sprite collision helper (`CODE_0C9613` / `CODE_0C9926`
  / `CODE_0C9B02`) which in turn calls the global `CODE_03B20B` (sets
  $60AA = $FC00 Yoshi upward-knockback velocity + $60C0 / $60D2 flag-
  setting) and plays `!Define_YI_SoundID13_SpringBounce`. The three
  helpers are structurally identical -- same instruction sequence
  with different per-variant follow-up effects.

The four-character codename used for this family in Nintendo's
internal references is not preserved here; the in-repo convention is
the descriptive name "Bumpty" (matching the official English release).

---

## 2. Per-variant state machines

The three Bumpties do NOT share a state pointer table. Each one has
its own state-ptr `dw` block stored immediately after its Main entry
in Bank0C. The state byte for all three lives at `$16,x` (offset 0
into a per-slot byte field, byte stride). All three use the same
sub-state byte at `$18,x` for nested sub-state-pointer dispatch.

### 2.1 $184 Bumpty -- 4-state main

`main_bumpty` at `$0C:930E`:

```
main_bumpty:
    JSL CODE_03AF23           ; standard gravity/OAM/floor-flag refresh
    JSR CODE_0C9613           ; per-frame Yoshi-contact test (see S3)
    LDA $16,x                 ; sub-state byte
    TAX
    JMP (DATA_bumpty_state_ptr,x)
```

`DATA_bumpty_state_ptr` (`$0C:931B`, 4 entries):

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0C9323` | **Walk.** Patrol toward target; on floor-hit dispatch through `DATA_bumpty_floor_substate_ptr` (state $18) for slide vs bounce. |
| `$02` | `CODE_0C9379` | **Collide-recover.** Just-hit Yoshi this frame. Calls intersection-test `CODE_0C96CF`; on overlap calls `CODE_06BE72` (the baby-Mario ejection routine) and stamps a randomised X-velocity sign / magnitude from the player low-bit RNG (`$00` + low-byte LSR pattern). Transitions to state $04. |
| `$04` | `CODE_0C93EF` | **Bumped.** Skid + recovery; dispatches sub-state at `$18,x` through `DATA_bumpty_bumped_substate_ptr` (skid then land). |
| `$06` | `CODE_0C9408` | **Despawn.** Used after a state-$04 expiry. Restores walk-cycle anim and resets velocity. |

Sub-tables off `$18,x`:

`DATA_bumpty_floor_substate_ptr` (`$0C:9360`, 2 entries):

| `$18,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0C9583` | **Slide.** Bumpty slides along floor; on $7A96 expiry the facing direction is XOR'd. |
| `$02` | `CODE_0C9487` | **Bounce.** Bumpty bounces upward (Y-vel $FC00); switches X-direction; sets anim frame $05/$06 alternation. |

`DATA_bumpty_bumped_substate_ptr` (`$0C:93FB`, 2 entries):

| `$18,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0C9414` | **Skid frame.** Wait for Y-velocity to flip positive (sprite landing); on land halt velocity, increment $18,x to $02, arm $7A96 + $7AF6 random-jitter timers. |
| `$02` | `CODE_0C944A` | **Land + recover.** Wait $7A96; on expiry restore state $06 (despawn / re-walk) with Yoshi-facing in $7400 via $77C2 EOR $0002. |

The 4-state main + 2-state sub-machine gives the base Bumpty 6
distinct observable phases: patrol-walk, patrol-slide, patrol-bounce,
collide-recover, post-hit-skid, post-hit-stand-up.

### 2.2 $19B Tackling Bumpty -- 6-state main

`main_bumpty_tackling` at `$0C:971D` dispatches through
`DATA_bumpty_tackling_state_ptr` (`$0C:972B`):

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0C9737` | **Walk.** Animate from frame $05 down via `$7402` DEC; when $7A98 expires, transition to state $02 with anim frame $06. |
| `$02` | `CODE_0C9797` | **Charge / launch.** Wait until anim frame = $06; set Y-vel $FE00 (jump up); increment `$18,x`. Otherwise pick spinning-tackle pose from `DATA_0C9836` (pose table) indexed by sub-byte at `$78,x` (the rotational phase), arm $7A96 from `DATA_0C983D` (pose-dwell table) indexed by floor(|X-vel|/4) -- faster Bumpty spins faster. |
| `$04` | `CODE_0C9845` | **Tackle (mid-tackle).** Per-frame spin animation by decrementing `$78,x` (wraps at 0 to $06). On wall-bounce (X-vel reversed sign) the bumpty stops and goes to state $06. |
| `$06` | `CODE_0C98BA` | **Recover / spring-up.** Animates frame $06 for $7A96 frames, then launches upward (Y-vel $FE00) for the recover-jump; arms $78,x = $03 and bumps state to $08. |
| `$08` | `CODE_0C97F5` | **Fall back to ground.** Watches $7A96 and $78,x; alternates facing every $7A96 expiry, falls into state $06 (despawn / cycle) once $78,x decrements past zero. |
| `$0A` | `CODE_0C98E8` | **Despawn / settle.** Used after a Yoshi collision. Stops X-velocity once the wall is hit and falls through to `CODE_0C9897`. |

Tables used by the spinning animation:

- `DATA_0C9836` (`$0C:9836`, 7 bytes): `$0D, $0A, $0B, $0C, $0C, $0B, $0A` -- spin-cycle pose frames.
- `DATA_0C983D` (`$0C:983D`, 8 bytes): `$0B, $0A, $09, $08, $07, $06, $05, $04` -- spin-cycle dwell-times indexed by velocity band.
- `DATA_0C9706` (`$0C:9706`, 2 words): `$FE58, $01A8` -- initial X-speeds keyed by facing ($7400 = 0 right -> $FE58; $7400 = 2 left -> $01A8). Used by init + state-$08 fall-back.

Note that the two velocity values are *not* mirror-equivalent ($FE58
+ $01A8 = $0000, so they ARE perfect mirrors -- the apparent
asymmetry is the two's-complement encoding). Same for the other
"left/right velocity-pair" tables in this file.

### 2.3 $19C Flying Bumpty -- 2-state main

`main_bumpty_flying` at `$0C:9A13`:

```
main_bumpty_flying:
    LDA EXRAM_NorSpr_CurrentStatus,x
    CMP #$0008                       ; status $0008 = "stomped"
    BNE .normal
    LDA #$0184                       ; Sprite ID $184 = base Bumpty
    TXY
    JML CODE_spawn_sprite            ; transmute slot into Bumpty
.normal:
    JSL CODE_03AF23                  ; gravity/OAM
    JSL CODE_0C9B02                  ; per-frame Yoshi-contact test
    ; Pick a Y-accel-ceiling from DATA_0C99AD based on whether the
    ; current Y is above or below the spawn-Y anchor stored in $7A36:
    LDY #$00
    LDA $7182,x
    CMP $7A36,x
    BMI .below
    INY : INY
.below:
    LDA DATA_0C99AD,y
    STA $75E2,x                      ; OAM Y-accel ceiling
    LDA $16,x
    TAX
    JMP (DATA_bumpty_flying_state_ptr,x)
```

`DATA_bumpty_flying_state_ptr` (`$0C:9A43`, 2 entries):

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0C9A47` | **Hover.** Oscillates Y around the spawn anchor $7A36; X-vel slowly ramps in by $0008 per frame until > $0010, after which the bumpty switches into a `DATA_0C9ADF` anim-picker phase (uses `DATA_0C9AE3` if facing matches direction, else `DATA_0C9AE5`). |
| `$02` | `CODE_0C9A97` | **Dive.** Used after morph-back. X-vel nonzero -> picks anim from `DATA_0C9ADF`; X-vel zero -> waits $7A96 then steps `$77,x` counter (face-flip every step), at counter=3 commits a new X-velocity from `DATA_0C99B1`. |

The morph-into-Bumpty trick at the top of Main is the family's
cleanest implementation of "this hazard becomes a different hazard
on hit". When Yoshi stomps the FlyingBumpty, the engine sets
`CurrentStatus = $0008`; the very next frame the Main routine
detects the status change and tail-JMPs through `CODE_spawn_sprite`
to overwrite the slot with sprite ID $0184, fully transmuting the
slot. The new ground Bumpty inherits the slot's position and runs
its own `init_bumpty` on the next frame.

The spawn point's Y anchor is recorded in `$7A36,x` during Init.
This gives the flying Bumpty a "leash" around its spawn Y -- it
hovers up and down around that fixed coordinate.

Init has a high-bit-4 mirror branch on the spawn X-position
(`BIT #$0010` against the level-data spawn X-byte). When that bit
is set, init goes to `CODE_0C99FB` and sets the bumpty into state
$02 (dive) with an initial X-velocity from `DATA_0C99B1` -- this is
the level-data spawn flag distinguishing "hover here" from "dive
along".

Animation tables used:

- `DATA_0C99A9` (`$0C:99A9`, 2 words): `$FFE8, $0018` -- per-facing X-offsets for the second mirror spawn (when flipped, offset the bumpty by +/-$18 from its level-data X).
- `DATA_0C99AD` (`$0C:99AD`, 2 words): `$0800, $F800` -- Y-accel ceilings (hover boundaries).
- `DATA_0C99B1` (`$0C:99B1`, 2 words): `$FF80, $0080` -- mirrored X-vel pair (left vs right).
- `DATA_0C9ADF` (`$0C:9ADF`, 2 words): two pointers to anim sub-tables `DATA_0C9AE3` (`$01, $02`) and `DATA_0C9AE5` (`$03, $04`). The "picker" code at `CODE_0C9AE7` does `EOR #$01` to toggle inside the sub-table.

---

## 3. The contact mechanic

All three Bumpties are "no-stomp, bounce-Yoshi-off, eject-baby-on-side"
hazards. The mechanic is implemented three nearly-identical ways:

### 3.1 The shared collision-test pattern

Each variant has a per-Main collision helper:

- **$184**: `CODE_0C9613` at `$0C:9613`.
- **$19B**: `CODE_0C9926` at `$0C:9926`.
- **$19C**: `CODE_0C9B02` at `$0C:9B02`.

All three share the same five-step structure:

```
1. Check $7D36,x      ; if BMI (sprite is "held by another", or already in collision lock-out)
   -> CODE_0Cxxxx     ;    branch to per-variant "already-engaged" path
2. CPX $61B6 / BNE    ; if THIS slot is the global "stomp-bumpty" target,
   STZ $61B6 / RTS    ; clear the global and skip (we're already mid-bump)

3. ; "first-contact" path:
   LDA EXRAM_Player_SuperBabyMarioTimerLo
   BEQ +              ; if not in Super-Baby state, skip
   PLA / PLY / JML CODE_03B25B  ; in Super-Baby state -> route to "boom" disposal

4. ; standard contact:
   LDA $7C18,x        ; sprite right-edge X
   SEC : SBC $6122    ; - Yoshi center X
   SEC : SBC $7BB8,x  ; - sprite half-width
   CMP #$FFF8 / BCC + ; if Yoshi's center is to the *right* of sprite right-edge ...
   LDA $60AA          ; ... and Yoshi isn't already in upward-knockback ...
   BMI .skip          ;
   LDA #!Define_YI_SoundID13_SpringBounce
   JSL CODE_push_sound_queue
   JSL CODE_03B20B    ; Yoshi takes contact damage (knockback + invuln frames)

5. ; alternate branch -- side overlap below Yoshi's edge:
   LDA $60AA
   BPL +              ; if Yoshi NOT already in upward-knockback, skip
   STZ $60AA $60C0 $60D2  ; clear all knockback state (Bumpty cancels it)

6. ; final shared branch -- forward push of Yoshi:
   LDA #!Define_YI_SoundID13_SpringBounce
   JSL CODE_push_sound_queue
   LDY $77C2,x        ; per-variant; selects between push-up and push-aside tables
   LDA $60FC / AND DATA_0CxxXX,y  ; eligibility mask
   ; if eligible, write to $60A8 / $60B4 (Yoshi velocity) from DATA_0CxxXX,y
```

Per-variant velocity tables (the "knockback" magnitudes):

| Variant | "Push Y" magnitude | "Mask" |
|---------|--------------------|--------|
| `$184` | `DATA_0C960B = $FD00, $0300` | `DATA_0C960F = $0180, $0060` |
| `$19B` | `DATA_0C991A = $FD00, $0300` | `DATA_0C991E = $0180, $0060` |
| `$19C` | `DATA_0C991A = $FD00, $0300` | `DATA_0C991E = $0180, $0060` (reused) |

The Tackling and Flying variants share the same magnitudes (they
reuse the Tackling tables `DATA_0C991A` / `DATA_0C991E`); the base
Bumpty has its own pair `DATA_0C960B` / `DATA_0C960F` with identical
numeric values. Bump magnitude is therefore the same across all
three variants; only the per-Main follow-up logic differs.

### 3.2 What happens after the bump

For the **base $184 Bumpty**, the collision additionally:

- Stores `$77C2,x` into `$7400,x` (so the Bumpty faces Yoshi after
  the contact).
- Sets X-velocity from `DATA_0C969A = $0100, $FF00` (the mirrored
  push-toward-Yoshi pair).
- Arms a $0010-frame `$7540` cooldown.
- Sets `$7A38,x = $0001` -- the "post-contact-engaged" lock-out flag
  that gates state $00 from re-firing the contact (read at
  `CODE_0C9323` line `BEQ.b CODE_0C9345`).

For the **Tackling $19B**, the collision sets `$77C2 AND #$00FF`
into `$7400` (facing-toward-Yoshi), then transitions to state $0A
(the despawn / settle state). The Bumpty stops tackling on contact.

For the **Flying $19C**, the collision is a pure RTL after the
$60A8 stamp -- the bumpty keeps hovering / diving; only Yoshi takes
the knockback.

### 3.3 The baby-Mario interaction

The base $184 Bumpty's state-$02 (collide-recover) handler at
`CODE_0C9379` explicitly calls `JSL CODE_06BE72` (`Bank06.asm:7042`).
This is the engine's "baby Mario thrown off Yoshi" routine -- same
one called by the Toady family ($058 GreenToady, $05C PinkToady)
and a handful of other contact-hazardous enemies. It sets the
sprite's $76 = $09 (Yoshi-side state byte indicating baby is
panicking), arms a kidnap-window state at $7542 + $74A2, writes
`$701902 = $0002` to both the Bumpty slot AND Yoshi's slot (the
"both ends linked" flag), sets `$61B2 |= $4000` (Yoshi-cinematic
flag), zeroes `$0D9C`, and plays `MarioKidnapped` sound.

Critically, the Bumpty's entry in the return-dispatch table
`CODE_06C114` (`Bank06.asm:7345`) at the `$184` branch is just
`RTL` (line 7387 `CODE_06C16D`). This means: when the kidnap window
ends, the engine simply gives Baby Mario back. Bumpty is the only
non-Toady enemy that triggers this routine *without* itself
carrying the baby off-screen -- the contact knocks the baby loose,
the kidnap-state runs briefly, the baby comes back. (The Toady
branches at `CODE_06C16E` / `CODE_06C173` set up Toady-specific
fields for the carry-away mechanic.)

This is consistent with the in-game observation: a Bumpty contact
ejects the baby, the baby floats, Yoshi can recapture as long as
the timer hasn't run out -- but Bumpty itself does not run away
with the baby.

---

## 4. Per-sprite breakdown

### 4.1 $184 Bumpty (base)

The canonical "walking penguin" of the World-5 snow stages. Init at
`$0C:9306` is trivial:

```
init_bumpty:
    JSL CODE_02A007     ; standard sprite init (gravity, OAM, basic flags)
    JSR CODE_0C9497     ; arm walk-cycle: zero X-vel, pick $7A96 + $7AF6
                        ; pace timers from low player-RNG bits, set anim frame $06
    RTL
```

The walk routine `CODE_0C9497` is reused as the "back to walk" reset
from multiple states -- it picks a `$10 AND $003F + $0040` cooldown
($40-$7F frames) and a `$10 AND $001F + $0008` anim-pace timer
($08-$27 frames), with anim frame $06 ("standing/walking"). The
randomisation comes from the player low-byte RNG at `$10`/`$11`.

State $00 (walk) at `CODE_0C9323` is the main occupied state. It:

- Checks the post-contact lock-out at `$7A38,x`. If set, verifies
  that current X-velocity sign matches the facing in `$7400-1` (so
  the bumpty hasn't stopped or reversed). If mismatch, clears
  `$7A38` and `$7540` and re-arms via `CODE_0C9497`.
- Otherwise checks the floor flags `$7860 & $000C` (wall) vs
  `$7860 & $0001` (floor). On floor-hit, dispatches the sub-state
  pointer `DATA_bumpty_floor_substate_ptr` to either Slide or
  Bounce based on `$18,x`.

The contact between $184 and Yoshi uses the standard mechanism in
S3, then enters state $04 (Bumped), which sub-dispatches at $18,x to
$00 (Skid) waiting for Y-velocity to flip positive (landing), then
$02 (Stand-up) waiting for $7A96 to expire, then re-routes to state
$06 (Despawn / cycle) which calls `CODE_0C955C` (essentially a
mirrored CODE_0C9497 that uses DATA_0C94D6 instead of DATA_0C9483
for the larger post-bump X-velocity range).

Three X-velocity tables drive the base Bumpty's motion bands:

- `DATA_0C9483` (`$0C:9483`, 2 words): `$FF80, $0080` -- slow band
  (slide-pace, post-recover walk).
- `DATA_0C94D2` (`$0C:94D2`, 2 words): `$FF00, $0100` -- medium band
  (wall-redirect, post-bounce X-vel).
- `DATA_0C94D6` (`$0C:94D6`, 2 words): `$FE00, $0200` -- fast band
  (post-stomp despawn, charge-back-toward-Yoshi).

Each table is the mirrored-velocity pair for left/right facing.

The sprite is the morph-target for $19C FlyingBumpty -- when a flying
Bumpty is stomped, its slot transmutes into $184 and inherits the
spawn position.

### 4.2 $19B Tackling Bumpty

A more aggressive variant -- starts with a high X-velocity from
`DATA_0C9706` ($01A8 or $FE58 depending on facing), builds up
animation frames during walk (state $00), launches into a spinning
tackle (states $02 -> $04), wall-bounces with a tumble (state $04
detecting reversed X-vel sign), and recovers via state $06 (an
upward spring-up) into state $08 (fall-back). State $0A is the
"contact-after-tackle" terminal state.

Init at `$0C:970A` is unusually loud for a Bumpty:

```
init_bumpty_tackling:
    LDA $7400,x              ; level-data facing direction
    STA $76,x                ; mirror to wildcard byte 76 (used by state $08 fall-back)
    TAY
    LDA DATA_0C9706,y        ; pick initial X-vel: $FE58 right, $01A8 left
    STA EXRAM_NorSpr_XSpeedLo,x
    LDA #$0008
    STA $7A98,x              ; walk-to-launch countdown
    RTL
```

Note that `$76,x` is used as a *separate* state-byte alongside `$16,x`
(the main state) and `$18,x` (the sub-state for the floor-hit cases
on $184). The Tackling Bumpty stores its initial facing in `$76,x`
for later use during state $08 (fall-back).

The spin animation is the family's most elaborate. After Init, the
Bumpty walks while DECrementing anim frame `$7402,x` from frame $05
down -- when the frame falls below $06 the state advances to $02 with
anim frame $06 ("braced for launch"). State $02 fires the upward
jump at Y-vel $FE00 and arms the spin-cycle. State $04 runs the spin
by walking pointer `$78,x` backward through `DATA_0C9836` (which
itself is a triangle wave: $0D, $0A, $0B, $0C, $0C, $0B, $0A), with
per-step dwell-time picked from `DATA_0C983D` indexed by the
velocity-band quotient (faster X-vel = shorter dwell -> spin faster).

The spin terminates on wall-contact (state $04 detects X-velocity
sign reversal) by transitioning to state $06 (recover), which arms
another upward jump and falls into state $08 (in-air fall-back).
State $08 then either alternates facing (every $7A96 expiry) or, on
`$78,x` underflow, re-runs the entire init body (re-seed X-vel from
`DATA_0C9706`, reset state to $00) -- the Bumpty re-tackles.

### 4.3 $19C Flying Bumpty

The most visually distinct member. Init at `$0C:99B5` reads the
level-data spawn Y, stores it as the Y-anchor in `$7A36,x`,
subtracts $0008 to position the bumpty slightly above its anchor,
and then branches on bit $0010 of the spawn X:

- **Bit clear**: pairs with a second sprite slot (the "mirror"
  half), copies the anchor X into `$7A38,x` (X-anchor for hover
  oscillation), arms a `$7540 = $0002` Y-accel timer, and EORs
  facing to give the bumpty an initial outward velocity.
- **Bit set**: enters dive-mode immediately (state $02), seeds
  X-velocity from `DATA_0C99B1`, sets `$6FA2 |= $0001` (sprite
  bitwise-flag 1).

Main at `$0C:9A13` opens with the morph-on-stomp special-case
(see S2.3) -- before doing anything else, it checks for
`CurrentStatus == $0008` (stomped) and overwrites the slot's
sprite ID with $0184 if so.

The hover state ($00) oscillates Y by picking +/- Y-accel ceiling
from `DATA_0C99AD` ($0800 vs $F800) depending on whether the
current Y is below or above the anchor in `$7A38`. Inside hover,
once X-vel has crept above $0010, the bumpty switches into the
anim-picker phase using `DATA_0C9ADF` (a pointer-pair into two
2-byte anim sub-tables, picked by whether current facing matches
the X-vel direction).

The dive state ($02) animates more aggressively when X-vel is
non-zero, and when X-vel reaches zero increments `$77,x` (a step
counter) every $7A96 expiry; at step 2 the facing EORs; at step 3
the X-velocity is reset from `DATA_0C99B1` and the step counter
resets, producing a steady "left-right-left-right" dive pattern.

---

## 5. Spawn / level usage

Bumpties are level-data sprites (no parented spawn relationships in
either direction). They appear primarily in World-5 (snow / ice)
levels:

| Level ID | Name | Likely use |
|----------|------|------------|
| `$30` | BLIZZARD | W5-1 -- expected Bumpty presence (snow theme). |
| `$31` | RideTheSkiLifts | W5-2 -- expected. |
| `$32` | DangerIcyConditionsAhead | W5-3 -- expected. |
| `$33` | SluggyTheUnshavensFort | W5-4 -- ice fort. |
| `$34` | GoonieRides | W5-5 -- snow level. |
| `$36` | ShiftingPlatformsAhead | W5-7 -- expected. |

The exact per-level sprite-list parse for Bumpty IDs has not been
extracted here -- a deep cross-reference of `DATA_<level>_sprite`
streams against `$0184` / `$019B` / `$019C` bytes would close that
out. The W5 theming + the in-game observation is the proximate
evidence; the sprite-list parser is documented in
`docs/leveldataengine.md` S5.

No Bumpty is ever spawned by another sprite at runtime (unlike the
Bandit family's bucket/cloud/zeppelin spawners). The only Bumpty -> 
Bumpty transition in the codebase is the $19C-stomp -> $184 morph
in-slot.

---

## 6. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` lines 418, 441, 442 -- canonical
  sprite IDs and one-line summaries for `$184`, `$19B`, `$19C`.
- `yi/Banks/Bank0C.asm`:
  - `$184 Bumpty`: Init/Main at lines 2531-2557 (`init_bumpty`,
    `main_bumpty`, `DATA_bumpty_state_ptr`).
  - State handlers `CODE_0C9323` (walk), `CODE_0C9379` (collide-
    recover), `CODE_0C93EF` (bumped), `CODE_0C9408` (despawn).
  - Sub-state ptrs `DATA_bumpty_floor_substate_ptr`,
    `DATA_bumpty_bumped_substate_ptr`.
  - Helper `CODE_0C9613` (per-frame Yoshi-contact test).
  - Velocity tables `DATA_0C9483`, `DATA_0C94D2`, `DATA_0C94D6`,
    `DATA_0C969A`.
  - `$19B TacklingBumpty`: Init/Main at lines 3101-3134
    (`init_bumpty_tackling`, `main_bumpty_tackling`,
    `DATA_bumpty_tackling_state_ptr`).
  - Spin tables `DATA_0C9836`, `DATA_0C983D`. Velocity-pair
    `DATA_0C9706`.
  - Helper `CODE_0C9926`.
  - `$19C FlyingBumpty`: Init/Main at lines 3470-3543
    (`init_bumpty_flying`, `main_bumpty_flying`,
    `DATA_bumpty_flying_state_ptr`).
  - Anim-table tables `DATA_0C9ADF`, `DATA_0C9AE3`, `DATA_0C9AE5`.
  - Anim-picker `CODE_0C9AE7`.
  - Helper `CODE_0C9B02`.
- `yi/Banks/Bank03.asm`:
  - Lines 464, 487, 488 -- Init pointer-table entries.
  - Lines 914, 937, 938 -- Main pointer-table entries.
  - Lines 1365, 1388, 1389 -- StompRt pointer-table entries.
  - Lines 1816, 1839, 1840 -- RideYoshiRt pointer-table entries
    (all three RTL-stub immediately at the shared collapse-point).
  - Lines 3490, 3513, 3514 -- RideYoshiRt label sites.
  - Lines 4294-4296 -- StompRt label sites (all fall into
    `head_bop_common` at line 4303).
  - `head_bop_common` body at line 4303-4331 (sets Yoshi $75E2 =
    $0400 upward kick, OAM front-priority bits; does NOT die).
- `yi/Banks/Bank06.asm`:
  - `CODE_06BE72` at line 7042 -- shared baby-Mario ejection
    routine (called by base Bumpty state-$02 collide-recover).
  - `CODE_06C114` baby-return dispatcher at line 7345; line 7368
    is the Bumpty branch (just RTL -- Bumpty doesn't run away with
    the baby).
- `yoshisisland-disassembly/disassembly/bank0C.asm` -- Raidenthequick's
  descriptive labels (`init_bumpty`, `main_bumpty`,
  `init_bumpty_tackling`, `main_bumpty_tackling`,
  `init_bumpty_flying`, `main_bumpty_flying`); verified
  label-by-label.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  that routes `CurrentStatus = $0008` (stomped) through to
  `head_bop_common`; also covers the `$7D36,x` "held-by-other"
  lock-out flag and the `$61B6` global "current stomp target" word
  referenced by all three collision helpers.
- `docs/leveldataengine.md` S5 -- sprite-list stream format
  (relevant for tracing which levels spawn which Bumpty).
- `ys_enmy*.asm` -- parallel engine asm; relevant for the shared
  on-contact pattern (the same $60A8/$60B4/$60AA Yoshi-velocity
  registers, the same $7860 floor-flag bit layout).

---

## 7. Open questions

- **Why three nearly-identical collision helpers?** `CODE_0C9613`,
  `CODE_0C9926`, `CODE_0C9B02` share the same five-step structure
  but differ in the follow-up step (which per-variant state to
  transition to, which $77C2-vs-$7400 tag to use). It would be
  natural to factor the common prefix into a shared subroutine
  with a per-sprite-ID branch on follow-up; instead the family
  triplicates the body. Unclear if this is an artefact of original
  separate-author bodies or a deliberate per-variant tuning choice
  -- diff'ing the bytes shows the prefix is byte-identical for the
  first 20-ish instructions of each.

- **`$7A38,x` and `$7A36,x` re-purposing.** Base Bumpty uses
  `$7A38,x` as a post-contact-engaged flag; Flying Bumpty uses
  `$7A36,x` as a Y-anchor and `$7A38,x` as an X-anchor (different
  semantics). Tackling Bumpty uses `$7A98,x` as a walk-to-launch
  countdown. The slot-field overload mirrors the pattern in other
  families (e.g. Bandit family `$701900` overload documented in
  `docs/family-bandits.md` S6). A richer EXRAM-aliasing convention
  could disambiguate.

- **`DATA_0C9ADF` / `DATA_0C9AE3` / `DATA_0C9AE5` semantics.** The
  flying Bumpty anim picker walks a pointer-into-pointer-table
  structure: `DATA_0C9ADF` holds two pointers, each into a 2-byte
  anim sub-table. The `CODE_0C9AE7` picker does `EOR #$01` on the
  current `$76,x` value to toggle between the two bytes. The exact
  meaning of the four anim frames `$01, $02, $03, $04` is not
  visualised here; it would need VRAM observation. Inference: $01
  / $02 are wing-up / wing-down for one facing, $03 / $04 are the
  mirrored pair for the other facing.

- **Tackling Bumpty's `$76,x` shadow facing.** The Tackling Bumpty
  copies its initial `$7400,x` (facing) into `$76,x` at Init time
  and uses `$76,x` as the "true facing" memory during state $08
  fall-back. The state machine uses `$76,x` for both the
  reset-trigger value and the velocity-table index. Why a separate
  shadow rather than just re-reading `$7400`? Possibly because
  `$7400` gets EOR'd mid-spin and the post-spin "what was my
  original direction" needs to survive.
