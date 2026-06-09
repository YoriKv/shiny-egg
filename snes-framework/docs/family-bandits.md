# YI Bandit family reference

Standalone reference for the Yoshi's Island Bandit sprite family --
white-hooded thieves (with a black "kerchief" mask) that knock the egg
out of Yoshi's tail or grab a Red Coin and then sprint off-screen with
it. The base Bandit ($020) is the most-encountered variant; the family
fans out into hidden, cloud-spawned, train-mounted, payload-of-a-payload,
and four mini-battle reskins.

This doc complements:

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  every entry here layers its own sub-state machine on top of.
- `docs/family-bandits.md` (this file) -- the Bandit-family sub-state
  machine itself: how `$76,x` indexes through the 13-state pointer
  table in Bank0E, how the cover/red-coin variants slot in, and how
  external spawners (clouds, buckets, Baron Von Zeppelins, mini-battle
  drivers) hand a fresh slot to base-Bandit code.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank0E.asm` (the main bandit bank), with companion code in
`Bank03.asm` (cloud spawner + StompRt stubs), `Bank04.asm`
(ShyGuyBanditTrap), `Bank05.asm` (BucketWithBandit), `Bank07.asm`
(Baron Von Zeppelin payload), `Bank0C.asm` (TrainBandit), and
`Bank11.asm` (mini-battle bandits). Cross-verified against
`yoshisisland-disassembly/disassembly/bank0E.asm` (descriptive labels
`init_bandit`, `main_bandit`, `head_bop_bandit`, `init_bandit_under_cover`,
`init_coin_bandit`, `main_coin_bandit`) and the parallel sources
`ys_dorobo.asm`, `ys_enmy*.asm`.

---

## 1. Family at a glance

Eleven sprites belong to (or directly spawn into) the Bandit family.
The base $020 Bandit is the canonical implementation; everything else
either reuses pieces of it, swaps the "what gets stolen" target, or
spawns a fresh Bandit slot programmatically.

| Sprite ID | Constant name | Bank | Init handler | Main handler | StompRt | Role |
|-----------|---------------|------|--------------|--------------|---------|------|
| `$020` | `Bandit` | 0E | `$0E:9410` `init_bandit` | `$0E:9439` `main_bandit` | `head_bop_bandit` | Standard egg-thief. 13-state machine. |
| `$05B` | `RedCoinBandit` | 0E | `$0E:11242` `init_coin_bandit` | `$0E:11305` `main_coin_bandit` | `head_bop_bandit` | Red-coin thief. Spawns paired Coin $115, 7-state main (5 entries alias base table). |
| `$0A3` | `LeftHidingBandit` | 0E | `$0E:9389` `init_bandit_under_cover` | `$0E:9440` shared `main_bandit` | `head_bop_bandit` | Hidden under cover (cardboard / tree). Pops out on Yoshi approach. |
| `$0A4` | `RightHidingBandit` | 0E | `$0E:9390` shared with `$0A3` | `$0E:9441` shared `main_bandit` | `head_bop_bandit` | Mirror of $0A3. |
| `$0BC` | `WingedCloudWithBandit` | 03 | `init_winged_cloud_B` | shared cloud Main | -- | Not a Bandit, but pops one: on Yoshi-hit dispatches to `CODE_pop_bandit` ($03:9534) which spawns a fresh $020 slot. |
| `$072` | `TrainBandit` | 0C | `$0C:14363` `init_train_bandit` | `$0C:14386` `main_train_bandit` | shared stub | A chalk-style "Bandit on a train" -- only active during the Train form ($61D6 = 0, $6180 set); uses a SuperFX intersection test against `$0CF19C` chalk-stamp table. |
| `$122` | `BucketWithBandit` | 05 | `$05:8977` shared `init_bucket` | `$05:9015` shared `main_bucket_obj` | shared stub | A bucket carried/dropped by a Bandit. On tip-state, dispatches `CODE_05C7D4` -- spawns a fresh $020 slot below the bucket. |
| `$12A` | `ShyGuyBanditTrap` | 04 | `$04:1380` `init_shy_guy_bandit_trap` | `$04:1496` shared `main_shy_guy` | shared stub | A *shy-guy* (not a bandit) preloaded into trap sub-state $05; on contact converts the slot to a shy-guy ($01E) via `ride_bandit_shyguy` ($04:2315) and triggers forced level-exit ($7E48 = $FFFF). Mis-named for historical reasons -- the "bandit" in the name refers to the cinematic trigger, not the sprite kind. |
| `$176` | `BaronVonZeppelinCarryingBandit` | 07 | `$07:14023` `init_bvz_bandit` (payload-index 6) | `$07:14177` shared `main_bvz_simple` | shared stub | Zeppelin variant whose drop payload is $020. Reuses the 13-entry BVZ payload-drop table (`DATA_07F7BD`) indexed by `$7A36,x = 6`. |
| `$1B3` | `GatherCoinsBandit` | 11 | `$11:5663` | `$11:5676` | shared stub | Race-Yoshi-for-coins mini-battle bandit. 5-state ptr `DATA_11B381` (scout / chase / pickup / retreat / idle). Uses SuperFX `FXCODE_098DDA` for line-of-sight against the coin pool. |
| `$1B5` | `PoppingBalloonsBandit` | 11 | `$11:4244` | `$11:4257` | shared stub | Companion to $1B6 (red balloons); 5-state ptr `DATA_11A80A`. Caches own slot to global `$112E` so the balloon sprite can find it. |
| `$1B7` | `SeedSpittingMinigameBandit` | 11 | `$11:6521` | `$11:6554` | own stub (aliased to `head_bop_common`) | Seed-spitter mini-battle bandit; duck/spit/recoil dispatch via `DATA_11BAF0`/`DATA_11BAFE` pose pickers; uses SuperFX `FXCODE_0ACE2F` for render. |
| `$1B9` | `P2SeedSpittingMinigameBandit` | 11 | `$11:6521` essentially-shared body at `$11:7888` | `$11:7917` shares spit logic with $1B7 | shared stub | Tighter-timing variant ($7042 hit-stun pre-armed); the harder counterpart in 2P mode. |

Of these, only `$020`, `$05B`, `$0A3`, `$0A4` are "true" bandit-family
sprites in the sense that they share `main_bandit` + `head_bop_bandit`
in `Bank0E.asm`. The others borrow the visual / role label but run
different code:

- `$0BC` is a winged-cloud (Bank03) that *creates* a Bandit on hit.
- `$072` is a Bank0C sprite that lives only during the Train form.
- `$122` is a Bank05 bucket-carrier; the Bandit comes out as a payload.
- `$12A` is a Bank04 shy-guy variant (the name is misleading).
- `$176` is a Bank07 Baron Von Zeppelin reskin.
- `$1B3` / `$1B5` / `$1B7` / `$1B9` are Bank11 mini-battle reskins.

The base $020 Bandit appears throughout the game (it's the primary
"watch your egg" enemy from World 1-3 onward). Hiding variants $0A3 /
$0A4 are most visible in mountain and jungle stages. The Red Coin
Bandit $05B is sprinkled into red-coin levels as a steal-and-flee
mini-puzzle.

---

## 2. The shared `main_bandit` state machine ($020 / $0A3 / $0A4)

The base Bandit is driven by a 13-entry sub-state pointer table at
`DATA_0EC993` (Bank0E.asm:9478). The current state index lives in
`$76,x` (byte) and is dispatched by `main_bandit` as
`JSR.w (DATA_0EC993,x)` after `AND #$00FF / TAX`. The 13 entries:

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0ECD8A` | **Pace / patrol.** Pick a horizontal target offset, set walking facing direction, sound a 16-frame anim cooldown. |
| `$02` | `CODE_0ECE01` | **Walk-to-target.** Step toward `$701900` X-target, rotate through 6-frame walk anim (`DATA_0ECDFB`); when close enough, drop to state $00 for a fresh target. Includes proximity-trigger to state $08 (chase) when Yoshi is in reach. |
| `$04` | `CODE_0ECEB1` | **Airborne / Y-bounce.** Used after a lunge or fall. Watches the floor bit of `$7860,x`; on land, picks state $06 (idle bounce) or state $08 (chase) based on sprite ID. |
| `$06` | `CODE_0ECF19` | **Aim / leap.** Compute distance to Yoshi; if in reach (within ~$40 X, $A0 Y above), select a leap-Y-velocity from `DATA_0ED5AE`, halve X-velocity, set "carrying-egg" flag in `$701900` to 2, and switch to state $0C (mid-air with item). Otherwise continue charging via `CODE_0ED488` + state $0A (run). |
| `$08` | `CODE_0ECFEE` | **Recover from a stomp / Yoshi-bounce.** Wait for `$7A98` timer; flash facing every $10 frames via XOR `$7402` bits. On expiry, fall back to state $0C. |
| `$0A` | `CODE_0ED032` | **Run-toward-Yoshi / charge.** Mirror of state $02 but with the chase-direction in `$77C2,x` (Yoshi-facing reference). Animates from `DATA_0ECD7E`. Drops to state $00 when `$7A96` cooldown elapses. |
| `$0C` | `CODE_0ED08F` | **Carry-and-flee.** "I have stolen the egg/coin; sprint off-screen." Subtracts `$72C0` / `$72C2` (camera-relative offsets) from position each frame, then animates +/- on `$701902`. Calls `CODE_0ED39D` and stamps target tile coords. |
| `$0E` | `CODE_0ED0E9` | **Landing-after-flee / settle.** Triggered when the flee-runner lands on a floor (`$7860 & $1`). Halts X-velocity, picks a recovery state from `DATA_0ED0E1`. Also the path that runs when the bandit reaches the screen edge. |
| `$10` | `CODE_0ED183` | **Cooldown-wait.** 18-frame wait via `$7AF6`, then jumps back to state $0A. Used between bounces. |
| `$12` | `CODE_0ED1D0` | **Stomped-and-rolling.** Friction-decay on X-velocity; animate via `DATA_0ED1B5` (Bandit) or `DATA_0ED1C9` (Red Coin Bandit only); on velocity-zero either return to state $00 (Bandit) or state $08 with coin re-targeted (Red Coin Bandit). |
| `$14` | `CODE_0ED1D0` | **Stomp-roll-2.** Same handler as $12 (different entry value, identical body) -- the second of the 4-stomp sequence. |
| `$16` | `CODE_0ED264` | **Hidden under cover.** $0A3 / $0A4 idle: stays still, picks ambush-side based on Yoshi X-delta, when Yoshi is within $E0 X (and not blocked by $61B2), sets approach X-velocity from `DATA_0ED260` and switches to state $06. Animation just flips `$7402` between $1E/$1F. |
| `$18` | `CODE_0ED0E9` | **Lunge-arc-aim.** Same handler as $0E. Used right before / during the "leap with stolen item" parabolic arc. |

The handler chooses both an animation index (`$7402,x`) and a few
sub-timers (`$7A36`/`$7A98` for anim pace, `$7AF6` for state expiry).

### 2.1 Per-slot state held by a Bandit

Beyond the state byte at `$76,x`, the Bandit machine uses these slot
fields (all accessed via X):

| Address | Meaning |
|---------|---------|
| `$76,x` | Current sub-state (0..$18, as above). |
| `$78,x` | Stomp counter -- reset on spawn, incremented on each successful Yoshi-bop. Capped at 4 in `CODE_0ECC34` (sprite "falls through floor" past that). |
| `$79,x` | Stomp counter for the bounce-on-head sequence -- the 4-stomp Bandit-kill mechanism. Cap at 3 before recovery. |
| `$7400,x` | Facing direction (0 = right, 2 = left). Selected from sign of distance-to-Yoshi or a random bit, depending on state. |
| `$7402,x` | Animation frame (passed straight through to OAM builder). |
| `$7A36,x` | Generic anim timer #1 -- frame index inside per-state walk/run cycles. |
| `$7A96,x`,`$7A98,x` | Generic per-slot countdowns (animation pace + state expiry; see `docs/spritestateengine.md §10` Q4). |
| `$7AF6,x` | "Carry-fled / cooldown" timer. |
| `$7D36,x` | "Held-by" link -- the slot-index (in sprite-table words) of *another* sprite holding this one (e.g. for the "Yoshi has the bandit pinned" case in `CODE_0ECBFE`). |
| `$7D38,x` | "Holding-link" flag -- non-zero means the Bandit currently has the player's egg/coin attached. Cleared on stomp. |
| `$701900,x` (EXRAM) | "Target X" -- the next horizontal position the patrol/walk state is heading toward. |
| `$701902,x` (EXRAM) | **Stolen-item flag** -- 0 = empty hands; 1 = carrying an egg/coin. Drives the "flee off-screen" behaviour. Set by the steal action in `CODE_0ECAA8`; cleared by `head_bop_bandit` via `CODE_0ECCC7`. |

### 2.2 The four canonical phases of a Bandit life

The state machine above implements four observable behaviours:

1. **Patrol** ($00 -> $02). Bandit walks back and forth between two
   target X coords picked from a small +/- $20 offset around its
   current position.
2. **Approach** ($08 -> $0A). When Yoshi enters the screen-relative
   reach window (within ~$50 X / ~$30 Y per `CODE_0ECE65`), the bandit
   pivots to face Yoshi and switches to a faster run.
3. **Steal** (`CODE_0ECAA8` -- not a state, runs from $10). When the
   bandit overlaps Yoshi and Yoshi is carrying an egg (`$60AB` carry
   flag negative), the bandit invokes `CODE_03A5B7` (the engine's
   "transfer carried item" routine) which detaches Yoshi's egg and
   marks `$701902,x = 1` on the bandit slot.
4. **Flee** ($0C). With `$701902,x` set, the bandit ignores patrol /
   approach logic, ramps its X-velocity toward the screen edge, and
   despawns when off-screen (`CODE_0ECCF3` -> `CODE_03A31E` free-slot
   path).

A successful stomp during phase 3 or 4 re-routes the slot to
`head_bop_bandit` which calls `CODE_0ECCC7` -- that routine returns
the stolen egg to Yoshi via `CODE_06C114` (egg-respawn) and clears
the `$701902` flag.

### 2.3 The 4-stomp kill convention

Unlike Shy-Guy (1-stomp kill), the Bandit needs **multiple stomps** to
go down. `CODE_0ECC34` (Bank0E.asm:9830) counts `$78,x` and only
spawns the actual death-pop ($115) when the counter rolls past 4. The
intervening stomps spawn smaller "ouch" effect sprites and play
escalating shell-hit sound effects from `DATA_0ECBF7`
(SoundID $0C..$12, "ShellHit2..ShellHit8"). The 4-stomp pattern is
unusual in YI -- see `head_bop_bandit` for the dispatch.

---

## 3. Per-sprite breakdown

### 3.1 $020 Bandit (base)

The canonical implementation. Init at `$0E:9410` is trivial:

```
init_bandit:
    LDA #$0001 ; arm a 1-frame stomp-recovery timer
    STA $16,x
    STZ $701900,x ; target-X tracker
    STZ $701902,x ; stolen-item flag
    RTL
```

Main is the 13-state machine described in §2. Init/Main pair is
shared by `$0A3` / `$0A4` (which fall through to `init_bandit` after
positioning themselves under the cover -- see §3.3).

Sprite tile palette: the base Bandit's sprite gfx live in
`$0EC9C3 -> $6FA0,x = $7C20` (the bandit-priority palette block). The
$7C20 high bit is flipped at state $0E (`CODE_0EC9C3`) when the
"linked-to-Yoshi" branch fires, to put the bandit in front during
the eat-the-tongued cinema.

### 3.2 $05B Red Coin Bandit

A bandit that steals a Red Coin rather than an egg. Init at
`$0E:11242` is the elaborate one:

```
init_coin_bandit:
    JSL CODE_03D406        ; common bandit-family init (gravity, OAM)
    LDA #$0115             ; sprite-ID for the Coin
    JSL CODE_spawn_sprite_active
    BCS .have_coin
    JML CODE_03A31E        ; bail -- no slot for the coin
.have_coin:
    ; Position the freshly spawned coin slightly above the bandit:
    LDA $70E2,x  : STA $70E2,y
    LDA $7182,x  : SBC #$0010 : STA $7182,y
    LDA #$FFFF
    STA $7A96,y  STA $7A98,y  STA $7AF6,y    ; freeze coin animation
    INC : STA $7542,y                         ; coin sub-state -- "linked"
    LDA #$0022 : STA $7042,y
    LDA #$0800 : STA $7040,y
    STY $18,x                                 ; bandit remembers coin slot in $18,x
    TXA
    STA $701900,y                             ; coin remembers bandit slot in $701900,y
    ...
```

The key trick: this is a **two-way slot link**. The bandit puts the
coin's slot index in its own `$18,x`; the coin puts the bandit's slot
index in `$701900,y`. Both are checked every frame in
`main_coin_bandit` to verify the partner is still alive and carrying
the link.

Main at `$0E:11305` has its own 7-entry table `DATA_0ED8AB` (different
indices but 5 of the 7 entries point to the same `CODE_0EC*` handlers
as the base bandit). The extra logic on top:

- Every frame the bandit position is mirrored to the coin slot via
  `DATA_0ED935` -- a 33-byte Y-offset table indexed by `$7402,x`
  (animation frame). So the coin "rides" the bandit's head, swinging
  forward/back with the walk cycle.
- `CODE_0ED956` is the Red Coin Bandit's variant of the patrol-state
  proximity check. If the bandit is being held by another sprite
  ($7D36,x set), it runs `CODE_03B25B` (forced-detach for stomp
  cleanup) instead of the usual `CODE_03A5B7` (Yoshi-touch transfer).

When the Red Coin Bandit is stomped, `head_bop_bandit` runs
`CODE_0ECCC7` which detaches the linked coin -- the coin pops out
where it can be re-collected. This is the recovery mechanism.

### 3.3 $0A3 / $0A4 Hiding Bandits

Initialized via `init_bandit_under_cover` ($0E:9389) which uses the
sprite-ID parity trick:

```
init_bandit_under_cover:
    LDA #$001E : STA $7402,x       ; cover-graphic frame
    LDA EXRAM_NorSpr_SpriteID,x
    SEC : SBC #$00A3               ; 0 for $0A3 left, 1 for $0A4 right
    ASL                            ; -> 0 or 2
    STA $7400,x                    ; store as facing
    TAY
    LDA DATA_0EC963,y              ; { $FFFC, $0004 } -> -4 or +4 X-offset
    CLC : ADC $70E2,x : STA $70E2,x
    LDY #$16 : STY $76,x           ; start in HIDDEN state ($16)
    ; falls through to init_bandit:
init_bandit:
    LDA #$0001 : STA $16,x
    ...
```

This is the cleanest variant-encoding mechanism in the family:
`SpriteID - $0A3` resolves to {0, 1} which selects the X-offset (cover
sits to one side of the bandit's spawn point) and is mirrored into
`$7400,x` so the post-emerge facing direction is already correct.
Then it falls through to `init_bandit` rather than RTL'ing, so the
common init runs without duplicate code.

Main is **literally identical** to base Bandit -- the same label
`main_bandit` lives at `YI_NorSpr020_Bandit_Main /
YI_NorSpr0A3_LeftHidingBandit_Main / YI_NorSpr0A4_RightHidingBandit_Main`.
The behavioural divergence is entirely driven by the initial state byte
$16 (hidden) which keeps the bandit pinned until Yoshi triggers the
ambush in `CODE_0ED264`.

### 3.4 $0BC WingedCloudWithBandit

Not a Bandit sprite at all -- it's a generic winged-cloud
(`init_winged_cloud_B`, see `docs/spritestateengine.md`) whose
pop-handler is `CODE_pop_bandit` ($03:9534):

```
CODE_pop_bandit:
    SEP #$10
    LDX $12
    JSL CODE_despawn_sprite_clear_graphics ; remove the cloud
    LDA #!Define_YI_NorSpr020_Bandit       ; $0020
    TXY
    JSL CODE_spawn_sprite                   ; spawn a Bandit in our slot
    LDA #$0002 : STA EXRAM_NorSpr_CurrentStatus,x  ; mark as alive
    LDA #$000C : STA $76,x                  ; jump to state $0C (carry-and-flee)
    LDA #$FD00 : STA EXRAM_NorSpr_YSpeed,x  ; arc upward
    LDA #$0017 : STA $7402,x                ; anim frame -- arcing
    RTL
```

A key detail: the spawned Bandit starts in state $0C ("carry-and-flee")
with a `$701902` flag of 0 -- so it's already mid-air running away,
just without anything in its hands. The cloud-spawned bandit is a
"chase me to get the prize" puzzle (you stomp the running bandit to
make it drop... nothing, unless you've also tagged it with a held
item). This is consistent with the winged-cloud convention: clouds
seed enemies, not rewards.

### 3.5 $072 TrainBandit

A specialised variant for the Train form of Yoshi (`!PlayerForm08`).
Init at `$0C:14363` is trivial -- it just picks an initial frame from
`DATA_0CF17C`. Main at `$0C:14386`:

```
main_train_bandit:
    JSL CODE_03AF23                         ; standard gravity/anim
    LDA EXRAM_Player_CurrentForm
    CMP #!Define_YI_PlayerForm08_Train
    BNE .idle
    LDA $61D6 : BNE .idle                   ; not currently mounted
    LDA $6180 : BNE .active
.idle:
    STZ $7A98,x  STZ XSpeed,x  STZ YSpeed,x
    LDA #$0040 : STA $7AF6,x                ; idle cooldown
    RTL
.active:
    JSR CODE_0CF2F9                          ; SuperFX render
    JSR CODE_0CF260                          ; SuperFX intersection-test against chalk-stamp table
    JSR CODE_0CF2A1                          ; apply deflection / response
    ...
```

The interesting bit is the **SuperFX intersection test**. The train
bandit doesn't have ground physics -- it scribbles ink on a "chalk
stamp" plane (`$0CF19C` is a 58-byte stamp template). The Train Yoshi's
graphics buffer is the chalk plane; `FXCODE_09907C` is invoked to
intersect the bandit's position against the bytes, and per-stamp
deflection bytes pick a new velocity. Effectively the bandit "bounces
around inside the train-Yoshi level" until it's eaten.

This is the only family member that ignores the standard 13-state
machine entirely -- it has its own small set of branches because
the level it appears in (the World-1 train segment) doesn't use the
normal sprite physics.

### 3.6 $122 BucketWithBandit

A bucket sprite with a Bandit inside it. Shares Init / Main with
$021 (plain bucket) and $123 (bucket with coins) at `$05:8977` /
`$05:9015`:

- Init seeds gravity, sets `$7A36,x = $0100` (long anim cooldown),
  and records the bucket's "rest position" in `$701900` / `$701902`.
- Main runs the 5-entry table `DATA_05C4A3` (`DATA_bucket_obj_state_ptr`):
  - State $00 (`CODE_05C5EB`) -- idle, hangs in air with SuperFX sway
    animation.
  - State $01 (`CODE_05C6B1`) -- knocked (by egg or tongue), swings.
  - State $02 (`CODE_05C70D`) -- tip phase. Dispatches via
    `DATA_05C5E3` (`DATA_bucket_dispense_ptr`):
    - `$122` -> `CODE_05C7D4` -- spawn a fresh $020 Bandit slot
      below the bucket with Y-velocity $FE00 (upward kick) and
      sub-state $0C (carry-and-flee).
    - `$123` -> `CODE_05C7F9` -- shower coins instead.
  - State $03 -- empty rocking.
  - State $04 -- settle, then despawn.

The dispense routine writes the bandit's initial sub-state directly to
`$701978|EXRAMBankMirror,y` ($701900,y in some references for the
sub-state slot) -- this is the slot-mirror EXRAM region for sprite
sub-state bytes. The bandit it dispenses is functionally indistinguishable
from a level-spawned Bandit once it lands.

### 3.7 $12A ShyGuyBanditTrap (note: not actually a Bandit)

A common naming pitfall: this sprite has "Bandit" in the constant name
but is a **shy-guy** (Bank04) with a pre-loaded "trap" sub-state. Init
at `$04:1380`:

```
init_shy_guy_bandit_trap:
    LDY #$05 : STY $76,x      ; sub-state $05 = "in-trap, dispense at touch"
    RTL
```

Then it falls into the shared `main_shy_guy` ($04:1496) which uses the
9-entry shy-guy dispatch table `DATA_shy_guy_state_ptr`. Entry $05
points at `CODE_shy_guy_state_05_stub` (effectively a no-op while the
trap waits).

When Yoshi touches it (`$61D6 = $0087`), `ride_bandit_shyguy`
($04:2315) converts the slot's sprite-ID to `$01E` (regular shy-guy)
and sets `$7E48 = $FFFF` -- the latter is the "forced level-exit
cinematic" trigger consumed by the gamemode dispatcher. So the
"Bandit" in this constant's name refers to the **outcome** (a bandit-
flavoured trapping cinematic) not the **sprite kind**.

### 3.8 $176 BaronVonZeppelinCarryingBandit

A standardised payload variant of the Baron Von Zeppelin family. Init
at `$07:14023` is:

```
init_bvz_bandit:
    LDA #$0006             ; payload index = 6 (Bandit)
    BRA CODE_07F19E        ; shared BVZ init body
```

The payload index points into two parallel tables:
- `DATA_07F7A3` (`DATA_bvz_payload_sprite_ids`) -- 13 sprite IDs.
  Entry 6 = `!Define_YI_NorSpr020_Bandit`.
- `DATA_07F7BD` (`DATA_bvz_payload_drop_ptr`) -- 13 drop handlers.
  Entry 6 = `CODE_07F82C`.

`CODE_07F82C` spawns the bandit in-slot (`JSL CODE_spawn_sprite`),
writes sub-state $0C to `$7019D6` (carry-and-flee from drop), animation
frame $17 to `$7402`, and transitions the zeppelin slot itself to
status $0010 -- effectively the zeppelin *becomes* the bandit during
drop. The bandit then runs its own 13-state machine from there.

Main is shared with three other simple-payload BVZ variants
(`main_bvz_simple` at `$07:14177`).

### 3.9 $1B3 / $1B5 / $1B7 / $1B9 Mini-battle bandits

Four mini-battle variants in Bank11. They share the convention:
- Init centers the bandit at (X=$C0, Y=$C0) with frame $09
  (idle pose).
- Main runs a small private 5-state-ish machine driven by `$18,x`
  (not `$76,x` -- they don't share the Bank0E state table at all).
- Render uses SuperFX `FXCODE_098DDA` (LOS check) and `FXCODE_0ACE2F`
  (silhouette renderer).
- Stomp routes to the shared `head_bop_common` stub in Bank03.

These don't interact with Yoshi's egg/coin pool at all -- they're
mini-game opponents that pick objects (coins / balloons / seeds) out
of a contention pool. The "Bandit" name is purely cosmetic (the same
white-hood + black-mask sprite is reused).

Per-variant state ptrs:
- `DATA_11B381` (`$1B3`, 5 entries) -- gather-coins state machine.
- `DATA_11A80A` (`$1B5`, 5 entries) -- popping-balloons state machine.
- `DATA_11BA7C` + `DATA_11BAF0` / `DATA_11BAFE` (`$1B7`/`$1B9`) -- pose
  selectors for duck / spit / recoil.

---

## 4. Spawn / parent relationships

Where do Bandits come from in a level?

| Source | Mechanism | Notes |
|--------|-----------|-------|
| Level data | Sprite-list entry with ID $020 | The most common case -- read by `docs/leveldataengine.md`'s sprite-list parser. Standard `init_bandit` path. |
| Level data | Sprite-list entry with ID $0A3 or $0A4 | Hidden variants. `init_bandit_under_cover` adjusts position then falls into `init_bandit`. |
| Level data | Sprite-list entry with ID $05B | Red Coin Bandit. Spawns a paired `$115` Coin child via `CODE_spawn_sprite_active`. |
| Winged cloud `$0BC` | `CODE_pop_bandit` on Yoshi-hit | Replaces the cloud's slot with a Bandit in state $0C. |
| Bucket `$122` | `CODE_05C7D4` on tip | Spawns into a free slot, kicks upward with Y-vel $FE00. |
| Baron Von Zeppelin `$176` | `CODE_07F82C` on drop | Converts the zeppelin slot's sprite-ID to $020. |
| Mini-battle drivers | Direct level-data spawn | $1B3/$1B5/$1B7/$1B9 are level-data sprites in their respective mini-battle stages -- not parented. |
| Test mode | Debug menu | Not relevant to gameplay. |

Two interesting details:

**Slot reuse vs. fresh slot.** $0BC, $122, $176, $12A all *take over*
their parent's slot (the parent despawns or transmutes its sprite-ID).
$05B spawns a paired *coin*, not a paired bandit. There's no case in
the codebase where a bandit spawns another bandit -- the family doesn't
self-replicate.

**Yoshi-snatch flow.** The "bandit steals your egg" mechanic doesn't
use a dedicated `$0CE8` baby-mario-snatched flag (that flag is owned
by the Toady family -- see `docs/spritestateengine.md`). Instead the
egg-steal route goes through `CODE_03A5B7` (the engine's "transfer
carried item" routine), which:

1. Reads Yoshi's `$60AB` carry-flag.
2. Pops the Yoshi-side egg sprite (the egg follower in $60xx state).
3. Marks `$701902,x = 1` on the bandit slot.
4. Wakes the bandit's state $0C (carry-and-flee).

Recovery happens in `CODE_0ECCC7` (Bank0E.asm:9896): when the bandit
is stomped or killed and `$701902,x` was 1, the stolen egg is
respawned at the bandit's last position via `CODE_06C114`, then
`$701902,x` is cleared.

This is the only enemy in the game that steals **Yoshi's egg**; the
Toady-family enemies steal Baby Mario himself (a separate mechanic
that uses `$0CE8`). The two systems share the dispossession/return
contract but are otherwise unrelated.

---

## 5. The variant-encoding mechanism (note for engine archaeology)

A common pattern across the YI sprite engine is "one piece of code,
many sprite-IDs, dispatch via `LDA EXRAM_SpriteID,x / CMP #$xx`". The
Bandit family uses this aggressively:

**Pattern A: SpriteID-as-key-into-tables.** Used by
`init_bandit_under_cover` ($0A3 vs $0A4):

```
LDA EXRAM_SpriteID,x
SEC : SBC #!Define_YI_NorSpr0A3_LeftHidingBandit  ; { 0, 1 }
ASL                                                ; { 0, 2 }
TAY
LDA DATA_0EC963,y                                  ; { $FFFC, $0004 }
```

Two sprite-IDs -> ASL'd index into a 2-entry table -> directional
offset. This is the cleanest variant encoding in the codebase.

**Pattern B: SpriteID-as-conditional-branch.** Used everywhere in
`main_bandit` to distinguish Red Coin Bandit from regular Bandit:

```
LDA EXRAM_SpriteID,x
CMP #!Define_YI_NorSpr05B_RedCoinBandit
BEQ .red_coin_path
```

There are **9** such branch-points in `main_bandit` (lines 10012,
10097, 10165, 10550, 10572, 10915, 10926, 11093, 11133, 11201) -- the
Red Coin Bandit's behaviour is the regular Bandit's plus 9 small
divergence points. This is a less elegant pattern than Pattern A but
much easier to author when the divergence isn't symmetric.

**Pattern C: Shared label, fall-through init.** Used by all variants:

```
YI_NorSpr0A3_LeftHidingBandit_Init:
YI_NorSpr0A4_RightHidingBandit_Init:
init_bandit_under_cover:
    ...setup specific to hidden variant...
    ; FALL THROUGH (no RTL):
YI_NorSpr020_Bandit_Init:
init_bandit:
    LDA #$0001 : STA $16,x
    ...
    RTL
```

Three sprite-IDs (`$020`, `$0A3`, `$0A4`) and four labels collapse
to two physical Init bodies that share an exit path. Same applies
to `YI_NorSpr020_Bandit_Main` / `_0A3_` / `_0A4_` -- all three
sprite-mains pointers in `Bank03.asm` dispatch to the *exact same*
code address (the `main_bandit` body).

The Red Coin Bandit ($05B) does NOT use Pattern C -- it has its own
Init and its own Main entry point that just happens to share several
JSR'd handler bodies (Pattern B branches inside those handlers
distinguish base vs. red-coin behaviour). The reason: the Init logic
for $05B is too different (it has to spawn the coin partner) to
share an entry point.

---

## 6. Open questions / unclarities

- **State $14 vs $12.** Both dispatch to `CODE_0ED1D0` (Bank0E.asm:9488-9489).
  The state-byte values differ but the entry is identical. Likely a
  state-machine sequence step: $12 = first stomp-roll frame, $14 =
  second stomp-roll frame, both share one renderer. The distinction is
  used at line 10574 (`CPY.b #$14 / BNE`) where the base Bandit picks
  the alternate animation table `DATA_0ED1C9` only when in state $14.
- **State $18 = state $0E?** Both also share `CODE_0ED0E9`. State $0E
  is "landing after flee"; state $18 is "lunge-arc-aim." They share
  a body because both are "transient, animate while falling, halt on
  ground" patterns -- behaviourally similar enough to fuse.
- **`$701900` use as both X-target and slot-link.** In base Bandit it
  holds a target X-coord (chase destination). In Red Coin Bandit it
  holds a slot-index (the bandit's own slot, stored on the *coin's*
  slot). This is a slot-field overload by sprite-ID; could be
  documented as a separate alias once we have a richer EXRAM-aliasing
  convention.
- **TrainBandit ground-collision absence.** Confirmed it does not use
  the standard sprite-floor flag `$7860 & $1`. The chalk-stamp
  intersection is the floor. But: when does the train segment exit
  with a stuck bandit? Unclear if it gracefully despawns on
  level-exit; no explicit unspawn path observed in `main_train_bandit`.

---

## 7. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` -- canonical sprite IDs and one-
  line summaries for `$020`, `$05B`, `$0A3`, `$0A4`, `$0BC`, `$072`,
  `$122`, `$12A`, `$176`, `$1B3`, `$1B5`, `$1B7`, `$1B9`.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_main`, `spr_state_on_head_bop`, etc.) that runs
  `main_bandit` / `head_bop_bandit` on every alive Bandit slot.
- `docs/leveldataengine.md` -- how sprite-list entries spawn bandit
  slots.
- `docs/bossengine.md` -- not directly related, but the "shared
  state-machine across multiple sprite-IDs" pattern in §7.3 is the
  same trick used here.
- `yi/Banks/Bank0E.asm` -- the implementation of `init_bandit`,
  `main_bandit`, `init_bandit_under_cover`, `init_coin_bandit`,
  `main_coin_bandit`, `head_bop_bandit`. Lines 9389-11540.
- `yi/Banks/Bank03.asm` -- `CODE_pop_bandit` ($0BC's pop handler) at
  line 9534; the `head_bop_common` aliasing for StompRt stubs.
- `yi/Banks/Bank04.asm` -- `init_shy_guy_bandit_trap` (line 1381),
  `main_shy_guy` (1499), `ride_bandit_shyguy` (2316).
- `yi/Banks/Bank05.asm` -- `init_bucket` (9313), `main_bucket_obj`
  (9353), `CODE_05C7D4` bandit-dispense (9759), `DATA_bucket_obj_state_ptr`
  (9345).
- `yi/Banks/Bank07.asm` -- `init_bvz_bandit` (14176), `main_bvz_simple`
  (14333), `DATA_bvz_payload_sprite_ids` (14967),
  `DATA_bvz_payload_drop_ptr` (14983), `CODE_07F82C` bandit drop
  handler (15040).
- `yi/Banks/Bank0C.asm` -- `init_train_bandit` (14443),
  `main_train_bandit` (14466).
- `yi/Banks/Bank11.asm` -- mini-battle bandits at 4244 ($1B5), 5663
  ($1B3), 6521 / 6611 ($1B7 init/main), 7888 / 7917 ($1B9 init/main),
  plus state ptrs at 4333 (`DATA_11A80A`), 5763 (`DATA_11B381`),
  6602 / 6604 (`DATA_11BAF0` / `DATA_11BAFE`).
- `yoshisisland-disassembly/disassembly/bank0E.asm` -- Raidenthequick's
  descriptive labels: `init_bandit`, `init_bandit_under_cover`,
  `init_coin_bandit`, `main_bandit`, `main_coin_bandit`,
  `head_bop_bandit`. Verified label-by-label.
- `ys_dorobo.asm` -- parallel asm for the bandit family ("dorobou" is
  Japanese for "thief" -- the implementation file is named after the
  family role). Shares the multi-state-table pattern of `DATA_0EC993`
  ($020 13-state) and `DATA_0ED8AB` ($05B 7-state) with a parallel
  set of per-state handlers. Same physical structure, same lifecycle.
- `ys_enmy.asm` -- parallel engine dispatcher; relevant for the
  shared `head_bop_common` body that all bandit `_StompRt:` labels
  alias to.
