# YI Cinematic-actor + goal-area family reference

Standalone reference for the Yoshi's Island sprite cluster that drives
scripted cutscenes (intro / ending / Kamek-bubble), the level-clear
goal sequence, and the mid-level checkpoint. Unlike most YI sprite
families, the entries here share **very little code** -- there is no
common "main_cinematic_actor" dispatcher, no shared state table, no
shared StompRt stub. The grouping is thematic, not implementation-
level: every sprite below is a one-off scripted actor whose lifecycle
runs against either a specific level-mode (`!RAM_YI_Level_LevelHeaderLevelModeLo`),
a specific in-engine game-mode (`!RAM_YI_Global_CurrentGameMode`), or
a one-shot per-sprite state machine that ends with `JML CODE_03A31E`
(despawn / free slot).

The closest thing to common DNA is that several entries dance with
the engine's two "freeze" flags (`!EXRAM_YI_Level_FreezeYoshiFlagLo` /
`!EXRAM_YI_Level_FreezeSpritesFlagLo`), the player-state pin
(`!EXRAM_YI_Player_CurrentStateLo`), and the message-box state
(`!RAM_YI_Level_MessageBoxState`). Reading a cinematic actor's main
body is largely a matter of watching which freeze flag it sets, which
sound it queues, and which game-mode handshake it triggers on exit.

This doc complements:

- `docs/enginecore.md` -- the global game-mode dispatcher and the
  `gmXX` handlers that host the prologue / ending / bonus-game.
- `docs/levelloader.md` -- how Bank10's `gm38_load_intro_cutscene`
  primes the prologue arena before the actors of this doc populate
  it.
- `docs/family-kamek.md` -- `$053 KamekSayingOhMy` is cross-referenced
  here but the deep-dive lives there; the boss-arena Kamek $048 and
  the magic-shooter $1AD are also documented there.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_main`) every entry in this doc still runs underneath
  its own per-sprite scripted machine.
- `docs/bossengine.md` -- the goal-area sequence in §5/§7 here is a
  parallel of the post-boss key insertion ($014) handled there.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank02.asm` (Goal Ring + Middle Ring + Yoshi at Goal),
`yi/Banks/Bank05.asm` (End-Transformation Block), `yi/Banks/Bank06.asm`
(Baby Mario), `yi/Banks/Bank0C.asm` (Prologue Cutscene Yoshi),
`yi/Banks/Bank0F.asm` (Stork + Baby Luigi + GOAL letters + Bonus
Challenge sign), and `yi/Banks/Bank10.asm` (the gm38 + gm39 prologue
+ gm2a bonus-game hosts that spawn most of these sprites). Cross-
verified against Raidenthequick's descriptive labels (`init_baby_mario`,
`main_baby_mario`, `riding_baby_mario`, `init_stork`, `init_baby_luigi`,
`init_goal`, `main_goal`, `init_middle_ring`, `main_middle_ring`,
`init_yoshi_at_goal`, `main_yoshi_at_goal`, `init_yoshi_block`,
`main_yoshi_block`, `init_yoshi_in_intro_cutscene`,
`init_GOAL_text`, `init_BONUS`) and the parallel sources `ys_chr.asm`
(character/cutscene actors), `ys_game.asm` (game-mode dispatcher),
`ys_play.asm` (player state $14 / $18 / $1C), and `ys_enmy.asm`.

---

## 1. Family at a glance

Ten sprites belong to (or accompany) the cinematic-actor + goal-area
grouping. None of them share their per-frame Main handler.

| Sprite ID | Constant name | Bank | Init handler | Main handler | Spawned by | Role |
|-----------|---------------|------|--------------|--------------|------------|------|
| `$061` | `BabyMario` | 06 | `$06:BCC8` `init_baby_mario` | `$06:BCEC` `main_baby_mario` (+ `riding_baby_mario` $06:CF1A) | `gm0e` level fade-in via `CODE_04DC28` (level start), `gm38/gm39` prologue indirectly, `CODE_03B7BB` (Stork hand-off) | On Yoshi: anchored to Yoshi's back via `riding_baby_mario`. Off Yoshi: 15-state machine ($06:BCCE) covering cry timer, Kamek-bubble grab, Kamek-bubble bounce, re-mount. Forks to a separate 5-state machine when `!RAM_YI_Level_LevelHeaderLevelModeLo = $09`. |
| `$040` | `BabyLuigi` | 0F | `$0F:8D2F` `init_baby_luigi` | `$0F:8DB1` `main_baby_luigi` | placed by level-data designer in the Bowser-ending room and select prologue rooms | 2-state machine ($0F:8DC1): wait for player to approach within 96 px X, then crank through a 30-entry hardcoded anim script ($0F:8D57 / $8D75 / $8D93). Renders via SuperFX `FXCODE_088295`. |
| `$041` | `Stork` | 0F | `$0F:864B` `init_stork` | `$0F:865F` `main_stork` (no Raiden alias) | placed by designer in the intro-cutscene level and the post-boss-Bowser Mario-return cinematic | 3-state machine ($0F:8669): approach (idle until player X-distance < $100), 6-step flap-down sequence, infinite final-flap. Y velocity from 6-byte `DATA_0F864F`, timer from 6-byte `DATA_0F8655`, final-flap anim from 4-byte `DATA_0F865B`. |
| `$12D` | `PrologueCutsceneYoshi` | 0C | `$0C:FA4B` `init_yoshi_in_intro_cutscene` | `$0C:FA6E` `main_yoshi_in_intro_cutscene` | `gm38_load_intro_cutscene` at Bank10:10796 spawns 8 of these in a `LDX #$0E ... CODE_10DC05` loop, one per Yoshi-flock-position | 8-entry state table ($0C:FA77) where indices 1-7 collapse to the same handler. Each slot starts in state 0 (idle) and switches to state 2 only when the player Yoshi crosses X >= $01C8 (the Mario-rejoins cue), at which point this slot pins itself as the player (`PlayerState04` + `$70E2/$7182` -> player position) and the other 7 despawn. Per-slot palette/flip variation seeded from `DATA_0CFA3B`. |
| `$00D` | `GoalRing` | 02 | `$02:A52C` `init_goal` | `$02:A617` `main_goal` | placed by level-data designer at the end of every non-castle/non-fortress level | The end-of-level hoop. Init draws three quadrants via three back-to-back SuperFX `FXCODE_088619` calls (top-left, top-right, bottom-left -- the fourth is unused, leaving the hoop visually open at bottom-right by design). Main = 4-entry state machine `DATA_goal_ring_state_ptr` (`$02:A8E0`) covering watch-for-Yoshi, flash-and-activate, item-tally + flower-roulette, hand-off to Yoshi-at-goal. |
| `$00E` | `GOALLetters` | 0F | `$0F:8000` `init_GOAL_text` | `$0F:8019` `main_GOAL_text` | `goal_ring_state_02_award_items` ($02:AB7E) calls `CODE_spawn_sprite_init` once with sprite `$000E` -- a **single** slot is spawned that handles the entire GOAL banner via SuperFX `FXCODE_09ACDA` (the FX routine renders all 4 letters from one slot). | 4-phase per-slot machine indexed by `$16,x`: 0=rise (Y down to a target $A0), 1=settle (Y back up to $80), 2=hold (until `!RAM_YI_Level_DoBonusChallengeFlagLo == 0`), 3=sparkle-finale that spawns 5 ambient star sprites and then despawns. Palette seed from `DATA_5FCC10` to mirror at `$702ECE`. |
| `$00F` | `BonusChallengeSign` | 0F | `$0F:8135` `init_BONUS` | `$0F:8174` `main_BONUS` | spawned at gamemode-level boundary when entering a bonus-game scene | Centers the sign sprite at Layer1-X + $80, Layer1-Y - $40, seeds palette at `$702F2E` from `DATA_5FCBF2`, queues `SoundID95_BonusChallenge`. Main: 4-entry phase table `DATA_0F819F` (positions 0+1 both run `CODE_0F81AF`'s message-prep, position 2 starts a $0800 Y-velocity bounce, position 3 ticks the sign back down to Y=$50). Includes a per-frame palette-cycle pass `CODE_0F822B` (cycles the "S" lettering color from `DATA_0F8219` and the gradient from `DATA_0F8211`). |
| `$04F` | `MiddleRing` | 02 | `$02:9383` `init_middle_ring` | `$02:938E` `main_middle_ring` | placed by level-data designer at the level midpoint | In-level checkpoint. Init allocates a SuperFX dyntile slot via `CODE_03D406` and seeds `$7A36,x = $20` (the initial sparkle phase). Main: SuperFX `FXCODE_08D3F9` draws the sparkle, hit-tests Yoshi against ($7C16+-32, $7C18+-56 or +-40), and on contact arms `$7400,x` with the facing-direction. Sets both freeze flags and arms the first-midpoint tutorial msgbox ($27) iff the level is `!Define_YI_LevelID_WatchOutBelow`. The actual checkpoint persistence is done by `CODE_029507` (the level-state snapshot to `$7E79A6` / `$7E7BB0`). |
| `$08C` | `YoshiAtGoal` | 02 | `$02:AC75` `init_yoshi_at_goal` | `$02:AC86` `main_yoshi_at_goal` | spawned by `goal_ring_state_01_activate_goal` ($02:AA92) via `CODE_03A34E` (passive-init spawn) | The "Yoshi cheering at goal" static actor. Init does a dyntile-allocation distance check via `CODE_03AD74`. Main: on-floor (`$7860 & $0001`) zeros X-velocity, arms `$FD80` Y-velocity hop with $18 cooldown via `$7A96`, redraws via SuperFX `FXCODE_088293` using one of two LOOP-counter ptrs from `DATA_02AC82` (FXDATA_550000+$6080 or +$60A0 -- "ground pose" vs "airborne pose"). |
| `$098` | `EndTransformationBlock` | 05 | `$05:B6DE` `init_yoshi_block` | `$05:B75A` `main_yoshi_block` | placed by level-data designer at the end of any **transformation** sub-section (the post-vehicle restore-Yoshi block) | The Yoshi-shaped goal block. Init triggers a `$1E6` puff ambient sprite and renders the static block via FXCODE_088293. Main: 3-state machine `DATA_yoshi_block_ptr` (state $00=idle-stub, $02=touched/dispense, $04=cleanup-with-puff), guarded by a player-state check (`PlayerState18_SentTowardsBabyMario` triggers the dispense path). Uses SuperFX `FXCODE_0B8578` for the swept-volume Yoshi-vs-block intersection test. |

Cross-reference only (NOT deep-dived here -- see referenced doc):

| Sprite ID | Constant name | Bank | See |
|-----------|---------------|------|-----|
| `$053` | `KamekSayingOhMy` | 00 (V1.0) / 0F (V1.1) | `docs/family-kamek.md` §2 -- dedicated `ROUTINE_YI_NorSpr053_KamekSayingOhMy.asm`; pins camera, blinks/talks, queues `SoundID5B` and msgbox $82 on talk-frame 4, launches leftward, despawns at right margin. The "OH MY!" cutscene actor used in Bowser-castle approach + certain pre-boss vignettes. |

The cluster spans **four different banks** ($02 / $05 / $06 / $0C /
$0F) plus the prologue host in Bank10, with no shared sub-tree of code.
The closest things to "shared cinematic vocabulary" are:

- **SuperFX render bridge calls.** `FXCODE_088293` ("static sprite
  render with dyntile") is shared by YoshiAtGoal, BabyLuigi (via
  FXCODE_088295), EndTransformationBlock, and the Goal Ring's final
  cleanup. `FXCODE_088619` ("3-quadrant ring") is used by both the
  Goal Ring (3 quadrants on Init) and EndTransformationBlock (sweep-
  volume check via the related FXCODE_0B8578).
- **Freeze flags.** Every cinematic actor that pauses the game flips
  `!EXRAM_YI_Level_FreezeYoshiFlagLo` and
  `!EXRAM_YI_Level_FreezeSpritesFlagLo` -- Goal Ring on activate,
  Middle Ring on touch, Baby Mario on Kamek-bubble.
- **Player-state pin.** The goal sequence sets `PlayerState02_InCutscene`
  and later `PlayerState14_ActivateGoal`. The prologue cutscene pins
  `PlayerState1C_Prologue` and `PlayerState04`. The end-transformation
  block waits for `PlayerState18_SentTowardsBabyMario`. Baby Mario's
  Bank06 path triggers `PlayerState24` (pipe-exit-style pop-up) on
  re-mount via the Bandit/Toady carrier path (`CODE_06C237`).

Beyond these touchpoints, every entry below runs its own bespoke state
machine.

---

## 2. Baby Mario ($061)

Baby Mario is the most-elaborate of the cinematic actors. He has
**three distinct mode bodies** wrapped in one sprite:

1. **On Yoshi (`riding_baby_mario` at $06:CF1A).** The default state
   while Yoshi is upright with Mario. Anchors Mario to Yoshi's back
   X/Y, runs the cry-timer countdown (`$7A98`), and on hit dispatches
   the bubble-grab.
2. **Off Yoshi -- normal level (`main_baby_mario` at $06:BCEC).** A
   15-state machine indexed by `$76,x` and dispatched through
   `DATA_baby_mario_main_state_ptr` ($06:BCCE). Covers Mario in his
   Kamek-bubble, the cry timer, the bubble-physics (bouncing off
   walls + ceiling), and the re-mount-on-Yoshi-touch path.
3. **Off Yoshi -- intro cutscene (`CODE_06CA2D` at $06:CA2D).** A
   parallel 5-state machine indexed by `$76,x` and dispatched through
   `DATA_baby_mario_levelmode9_state_ptr` ($06:CA23). Active only when
   `!RAM_YI_Level_LevelHeaderLevelModeLo == $0009` (the prologue
   level-mode where Mario falls from the stork's beak). Reuses some
   sub-routines from the normal path but has its own physics.

The Init handler is **trivial**: 5 bytes (`init_baby_mario` at
$06:BCC8) -- stamps `$C0` (OAM priority bits) into `$7863`. All the
real setup happens in `gm0e_level_fadein_to_control` via
`CODE_04DC28` (Bank04:11725) and in the prologue host gm38/gm39.

### 2.1 The 15-state off-Yoshi machine (`DATA_baby_mario_main_state_ptr`)

Indexed by `$76,x` (byte). The entries:

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_06C32B` | **Bubble drift.** Floats up/down based on `$7862` (gravity flag) and `$0DB2` (max-height target). Toggles between 4 anim frames (`DATA_06C327`: $15/$16/$15/$17) on each $7A98 tick to "swim in place." |
| `$01` | `CODE_06C383` | **Mounted, normal.** While `$0B57 != 0` (Yoshi present), jumps to `CODE_06C414` (re-mount setup) -- the canonical "I'm back on Yoshi" branch. While not, runs a one-shot SuperFX velocity-computation via `FXCODE_0B86B6` (lerp toward Yoshi position) and parks at state $0D anim with $6FA2=$6040 (highest sprite priority). |
| `$02` | `CODE_06BCC6` | **No-op (RTL).** Used as a placeholder during the very brief frame after Yoshi catches Mario but before state transition. |
| `$03` | `CODE_06C48E` | **Crying-in-bubble.** Iterates `$16,x` through 21-entry tables `DATA_06C464` (frame index $20-$27) + `DATA_06C479` (per-frame timer 04/20). Calls `$7402` directly. |
| `$04` | `CODE_06BCC6` | **No-op (RTL).** Reserved entry. |
| `$05` | `CODE_06C4BD` | **Cry-and-bounce-up.** Variant on state $03 where every 9th frame arms `$FF00` Y-velocity (`!EXRAM_YI_Level_NorSpr_YSpeedLo`) and switches to the bounce-physics state ($07 or $0A). State $05 specifically also restricts to `$614E == 3` (a particular game-mode sub-state). |
| `$06` | `CODE_06C591` | **Cry-and-physics.** Tightest cry handler: every frame checks `$0C8A` (game-active flag); on bounce-off-wall, decides bounce direction from the `$75E2` Y-velocity sign and the `$7860` collision bits. Spawns Mario re-mount on Yoshi contact via `CODE_06BF73` (the "kamek-bubble pop -> $1E1 ambient sprite + sound + back to mounted" path). |
| `$07` | `CODE_06C6D1` | **Wait-for-Yoshi-pause.** State Mario sits in while `$7223` is negative ($7223 = "remote sprite holding Mario" link). On thaw, decrements $76. |
| `$08` | `CODE_06C4C4` | **Throw-anim.** Kamek-bubble carry-throw windup: cycles `$16,x` through `DATA_06C4AF` (10-byte anim list `$1B,$1C,$1D,$1F,$1E,$1F,$1D,$1F,$1E,$1F` -- 10 entries despite being driven 4 bytes per ASL); on $16 >= 9 selects a launch Y-velocity (`$FF80` from `DATA_06C4B9`) per Mario-facing and advances state. |
| `$09` | `CODE_06C61F` | **Cry-no-input.** Mirror of state $06 but with the `$7A98` clamp restoring `$0DB2` (max-height target) every $80 frames so Mario floats steadily upward toward the top of the screen. |
| `$0A` | `CODE_06C4C4` | **Throw-anim alt.** Variant of state $08 where on $16 >= 9 the Y-velocity is `$FF00` and the X-velocity is mirrored from `DATA_06C4B9` -- the "thrown sideways" launch. |
| `$0B` | `CODE_06C61F` | **Steady-cry alias.** Same handler as $09. Used to keep Mario crying through the auto-cry-timer regen path. |
| `$0C` | `CODE_06C6EC` | **In-flight Kamek-bubble.** The "Bandit/Toady carrying Mario" state. Restores `$7400` to Mario-X-velocity sign. Decrements a $7AF6 timer; on tick runs `CODE_06BFA4` (spawn an `$1E1` "pop" ambient sprite when Mario re-mounts Yoshi). |
| `$0D` | `CODE_06C4C4` | **Throw-windup alias.** Same handler as $08/$0A. The Bandit/Toady "I just grabbed Mario from Yoshi" entry-point. |
| `$0E` | `CODE_06C812` | **Spell-cast-launch.** When Kamek's spell explodes near Mario, this state launches Mario at a Kamek-vector angle: computes `LSR(abs(SuperFX_R6))` -> Y-velocity, mirrors via `$7C16` X-sign. |

Beyond `$76,x`, the slot uses these per-slot fields:

| Address | Meaning |
|---------|---------|
| `$16,x` | Sub-state anim index (resets to 0 on state-entry). |
| `$18,x` | "Held-by" slot index (set to the carrier's slot when grabbed by Bandit/Toady; cleared on re-mount). |
| `$76,x` | Current main-state ($00-$0E as above). |
| `$78,x` | Anim-cycle counter (used by `CODE_06C9D7` to detect frame-changed). |
| `$7862,x` | Gravity flag -- 0 = float, 1 = fall. |
| `$7AF6,x` | "Bandit/Toady carry timer" (set by `CODE_06C237` to $20 on grab). |
| `$7AF8,x` | Generic state-expiry timer (the float-back-up state $09 reads this; carry state $0C decrements it). |
| `$7D36,x` | "Held-by carrier" link (slot index of the sprite holding Mario). |
| `$0B57` (global) | "Yoshi present" -- 0 = Yoshi gone (Mario alone in bubble). |
| `$0B59` (global) | "Mario currently riding" -- set by `CODE_03BD40` once Mario is back on Yoshi. |
| `$0DB2` (global) | Max-height clamp for floating Mario (gets reset to player-Y - $30 each frame). |
| `$0D92` (global) | "Mario rescued" flag for life-counter scoring. |
| `$7E48` (global) | "Slot that owns Mario" (back-pointer). |

### 2.2 The level-mode-9 (intro-cutscene) 5-state machine

`DATA_baby_mario_levelmode9_state_ptr` ($06:CA23) is a separate
dispatch table used only when the prologue level-mode is active. It
shares some helpers with the main path but has its own physics:

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_06CDAB` | Stork-beak dangling: every frame, when both `$7A96` and `$7A98` are zero, ticks `$16,x` through a 10-entry frame table `DATA_06CD9D` (rolling Mario animation). On frame 9, picks a Y-velocity from 2-byte `DATA_06CDA7` ($FFC0 / $0040, based on `$7400` facing) and advances to state $01. |
| `$01` | `CODE_06CDEF` | Falling from the beak: cycles through `DATA_06CDE7` (4-byte frame table `$04,$05,$04,$06`) with a `$7A98 = 4-8` tick budget; per-`$7A96 == 0` boundary picks an X-velocity from `DATA_06CDEB` ($0080 / $FF80) and advances. |
| `$02` | `CODE_06CE2F` | Stork lets go and Mario drifts: one-shot SuperFX call (`FXCODE_0B86B6`) to compute a Mario-toward-target velocity (toward Bowser-Magikoopa's outstretched hand). Increments a one-frame guard at `$0D9C`. On completion: spawns the catch-pop ambient ($1E1) via `CODE_06BFA4` and clears the freeze flags. The "Mario falls into Bowser's clutches" beat. |
| `$03` | `CODE_06CE2E` | RTS -- placeholder identical entry. |
| `$04` | `CODE_06CEFB` | Brief X-velocity adjustment ($0200 or $FE00 from `DATA_06CEF7`) based on the sign of `$0D05 + $0DAD` (combined X-delta accumulators); jumps back into state $01 to keep the animation cycling. |

This level-mode-9 path is the only place where Mario's per-frame logic
goes through `CODE_06C9D7` for sprite-color cycling (Mario palette
changes per held-frame because the prologue colors his bubble).

### 2.3 The Kamek-bubble grab path

When a Bandit (`$020`), HidingBandit (`$0A3`/`$0A4`), RedCoinBandit
(`$05B`), or specific Toady variants run their "I want to grab Mario"
sub-state, they call into `CODE_06C237` ($06:C237). That code stamps
`$18` in the carrier's sub-state, points Mario's `$7D36` at the
carrier slot, arms Mario's $7402 to anim $17 ("being-carried" pose),
sets Y-velocity to `$FC00` (launch up off Yoshi), and arms the carry
timer at `$7AF8 = $20`. Once `$7AF8` expires and Mario is in state
$0C, `CODE_06BFA4` triggers the re-mount sound + ambient puff.

The 4-sprite list of "things that can grab Mario" is hardcoded as
explicit `CMP #!Define_YI_NorSpr020_Bandit` / `$0A3` / `$0A4` / `$05B`
checks in `CODE_06C1EF`. No other sprite can run the grab handshake
even if they set `$7AF8` -- the carrier-list check guards the swap.

---

## 3. The Stork delivery cinematic ($041)

The Stork is the iconic prologue actor that delivers Baby Mario and
appears again briefly when Mario is returned post-Bowser. Its Init
is essentially a no-op (`STZ $7400,x` then RTL); the entire delivery
flow is run from its 3-state main.

### 3.1 The 3-state main ($0F:8669 `DATA_0F8669`)

Indexed by `$16,x`. Each entry runs out of `Bank0F.asm`:

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0F866F` | **Approach.** Idle until the X-distance between the stork (`$70E2,x`) and the player (Mario) is within $100 px. On trigger: stamps `$18,x = $05` (frame index for the flap sequence), seeds `$7402,x` from `DATA_0F864F[$05] = $00`, seeds `$7A96,x` from `DATA_0F8655[$05] = $30`, and advances `$16,x` by 2 (-> state $01). |
| `$02` | `CODE_0F869A` | **Flap sequence.** Walks down through `$18,x` from $05 to $00, decrementing every time `$7A96` hits 0. At each step: reload `$7402` from `DATA_0F864F[$18]` (the per-step anim frame, alternating $02/$00) and reload `$7A96` from `DATA_0F8655[$18]` (per-step timer: $20, $04, $04, $08, $10, $30). When `$18` reaches -1, advance `$16,x` by 2 -> state $04 / final-flap. |
| `$04` | `CODE_0F86C1` | **Final flap loop.** Infinite 4-step animation using `DATA_0F865B` ($02,$03,$02,$01) with a hardcoded `$7A96 = $04` cadence. Walks `$18,x` from 3 -> 0 -> 3 -> 0 -> ..., never increments `$16,x` again. The stork stays in this state forever until despawned by an external trigger (level-mode change / `CODE_03A31E` despawn). |

Three things to note:

- **`DATA_0F864F` ("Y velocity") is misleading.** Despite the 6-byte
  declaration `db $02,$00,$02,$00,$02,$00`, it's actually used as an
  **anim frame index pair** (frame $02 = flap-down, frame $00 =
  flap-up). Stork has no actual Y-velocity field -- the bird flies in
  a deterministic arc set up by the host scene.
- **`DATA_0F8655` is the per-frame timer**, not "tick budget." Each
  entry is the `$7A96` value at which the next decrement of `$18,x`
  happens. So the flap sequence has timing $30 / $10 / $08 / $04 /
  $04 / $20 frames per step.
- The final-flap loop uses `$04` as a hardcoded timer, ignoring the
  6-byte table. The stork settles into a uniform wing-beat.

### 3.2 What hosts the Stork

The Stork is **placed by the level designer** in a per-level sprite
list, not spawned procedurally. Two specific levels host one:

1. **The intro storybook cutscene** (`gm38_load_intro_cutscene` at
   Bank10:10619). The Stork's level is loaded via the standard
   `YI_LevelDataPtrsAndEntranceData_Ptrs` table at level-data slot
   `$0A`. It carries Mario in his beak; Mario's level-mode-9 path
   (§2.2) controls the dangling animation.
2. **The post-Bowser ending storkflight.** Sub-section reached via
   gamemode $26 ending -- after Bowser is defeated the engine
   transitions to a similar cinematic that has the Stork return
   Mario to the Yoshis. Same code, different player-state harness.

At the level-list level, Stork has a no-physics flight path: the
camera and BG scroll move the world past the Stork (which is pinned
in screen coordinates), creating the illusion that the bird is
flying east at constant velocity.

Bank05 also has two `CPY.b #!Define_YI_NorSpr041_Stork` checks
($05:F71D, $05:F921 / `CODE_05F922` neighborhood) inside a
shared "settle on ground from flight" sub-routine; these are used to
end-cap the Stork's descent in the post-Mario-return arc -- when the
Stork reaches its target Y, the path branches to despawn-quietly
instead of bouncing.

---

## 4. Baby Luigi + Prologue Cutscene Yoshi ($040, $12D)

### 4.1 Baby Luigi ($040)

The Baby Luigi cinematic actor. Used in:

1. The prologue storybook intro -- Baby Luigi is dropped from the
   stork next to the player Yoshi flock.
2. The **Bowser ending** cinematic where Baby Luigi is also returned
   alongside Baby Mario.

Init (`init_baby_luigi` at $0F:8D2F):

- Calls `CODE_03AE60` (allocate a SuperFX dyntile slot from the
  shared pool; tags Luigi with a dyntile index in `$7722,x`).
- Calls `CODE_0F8D44` -- this is the **per-slot palette / OAM-priority
  seeder.** Reads `$7402,x` (which the level-data placement sets to a
  palette-row index 0-9), looks up an OAM flags byte from
  `DATA_0F8D3A` (`$20,$28,$28,$28,$28,$28,$28,$28,$28,$28`), ORs the
  low 3 bits of `$7041,x` (existing palette-row preserves) with that
  byte, and stores back. Net effect: row 0 sets OAM-attr-pair $20
  (palette 0, no flip, lo-pri), all other rows set $28 (palette 1).
- Zeros `$7400,x` (facing-direction reset).

Main (`main_baby_luigi` at $0F:8DB1):

- Calls `CODE_0F8E20` to draw Luigi (dyntile-based SuperFX render --
  uses `FXCODE_088295` "static actor with sprite-rotation table").
  When `$7402,x = 0` it uses `CODE_03AA52` (dyntile-direct render);
  otherwise uses `FXCODE_088295`.
- Calls `CODE_0F8E49` to **re-emit** the slot's dyntile data each
  frame (3-row SuperFX call -- `R3/R2` get position offsets from
  `DATA_0F8E39` + `DATA_0F8E41`, `R6` gets `#$0019` row count).
- Calls `CODE_03AF23` (the freeze-aware per-frame Main update).
- Dispatches via `$18,x` through `DATA_0F8DC1` (2 entries):
  - State `$00` (`CODE_0F8DC5`): **Wait for player.** Until the X
    distance between Luigi (`$70E2,x`) and Mario (`!EXRAM_YI_Player_XPosLo`)
    drops below $60, do nothing. On trigger: stamps `$19,x = $1D`
    (frame 29, top of the 30-step anim script), seeds `$7A96` from
    `DATA_0F8D57[$1D] = $04`, seeds `$7402` from `DATA_0F8D75[$1D] = $00`,
    seeds `$16` from `DATA_0F8D93[$1D] = $00`, calls `CODE_0F8D44`
    (re-seed palette), advances `$18,x` to $02.
  - State `$02` (`CODE_0F8DF8`): **Run anim script.** Counts down
    `$19,x` from $1D to 0, decrementing every time `$7A96` hits 0.
    At each step: reload all three control bytes from the 30-byte
    tables `DATA_0F8D57` / `DATA_0F8D75` / `DATA_0F8D93`. When
    `$19` reaches -1, advance to state $04 = RTL (CODE_0F8E1F).

The three tables encode a 30-frame scripted anim where Luigi runs
from his start position, hops up, then settles. `DATA_0F8D57`
controls per-frame timer (mostly $02 with $20/$10 at key beats);
`DATA_0F8D75` controls anim-frame index (9/8/4/6/7/6/4/5/4/3/2/1/0
walk-cycle followed by 17 frames of "still" frame 0); `DATA_0F8D93`
controls Y-position-table offset (mostly 0 with $04/$06 spikes
during the hop).

### 4.2 Prologue Cutscene Yoshi ($12D)

Eight slots, all spawned at the same instant by `gm38_load_intro_cutscene`
(Bank10:10796 in the `LDX #$0E ... CODE_10DC05` loop). Each slot is
distinguished by `$16,x` (its index 0-7 in the Yoshi flock) and by
`!EXRAM_YI_Level_NorSpr_GenericTable701976` (its slot-index back-pointer).
Per-slot fixed positions come from `DATA_10D9EF` (X coords) and
`DATA_10D9FF` (Y coords).

Init (`init_yoshi_in_intro_cutscene` at $0C:FA4B):

- Reads `$16,x` as the slot-index.
- ORs `$7042,x` with `DATA_0CFA3B[$16,x]` -- per-slot OAM attribute
  override. The 8-entry table `$000A,$000E,$000C,$0008,$0002,$0000,$0004,$0006`
  sets each Yoshi-slot's palette + flip-bit pair: slots 0, 4, 5
  spawn unmirrored (left/right facing right); slots 6, 7 mirror via
  the `$0002` and `$0008` bits.
- Stashes the original `$7182,x` (Y position) in `$76,x` as the
  "ground level" reference.
- Jumps to `CODE_0CFB20` -- the **per-slot anim-script setup**. This
  picks an anim script from `DATA_0CFA2B[$16]` (8 entries pointing into
  `DATA_0CF9CB` / `DATA_0CF9E3` / `DATA_0CF9FB` / `DATA_0CFA13` --
  4 distinct walk-cycle anim scripts shared across the 8 Yoshi slots),
  derives a starting offset from frame counter `$10 & $07`, reads
  pose + timer from the script, and seeds `$7A36,x` (anim-table
  pointer) + `$7402,x` (current frame).

Main (`main_yoshi_in_intro_cutscene` at $0C:FA6E):

- Calls `CODE_0CFB64` first -- the **ground-clamp + bounce trigger**.
  If the slot's current Y `$7182,x` is below its original ground-Y
  `$76,x`, snap back, arm `$0100` Y-velocity (bounce-up), and stamp
  `$7860 = $0001` (floor-hit flag).
- Dispatches via `$16,x` through the 8-entry
  `DATA_prologue_yoshi_state_ptr` ($0C:FA77). State $00 has its own
  handler; states $01-$07 all collapse to `CODE_0CFAB0`.

The 8-state table:

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0CFA87` | **Pre-Mario-arrival.** Reads `$0D27` (intro phase pointer; see §8.1). Until `$0D27 >= $04`, runs the standard walk-cycle script via `CODE_0CFAED`. Once `$0D27` crosses 4 (Mario arrives), **pins this slot as the player**: sets `PlayerState04`, writes `$611A = $0003` (carry-stack count), copies own X/Y to `!EXRAM_YI_Player_XPosLo / YPosLo`, and `JML CODE_03A31E` -- despawns this Yoshi-slot and lets the player Yoshi engine take over. |
| `$01-$07` | `CODE_0CFAB0` | **Hopping after Mario-arrival.** Until player X >= $01C8 (the cue that this Yoshi should hop into Mario's catch position), run a standard walk-script tick via `CODE_0CFAED`. Once player crosses $01C8: arm `$7400 = $0002` (turn around), check the floor-hit flag (`$7860 & $0001`), and on contact: pose to frame $0012, set up bounce-timer (`$7A98 != 0` blocks new hops), arm `$FC00` Y-velocity (the "bouncy" jump), then back to standard tick. |

The interesting design choice is that **all 7 non-player slots run
the same `CODE_0CFAB0` handler** -- the "which Yoshi is the player"
selection happens in state $00 of slot 0 only (which is the one whose
state-index byte `$16,x` starts at 0 and thus dispatches to
`CODE_0CFA87`). The other 7 slots run state-1..7 from spawn and never
hit `CODE_0CFA87`. Effectively the 8-entry pointer table is
"state-0 = leader-Yoshi; states 1-7 = follower-Yoshi" with the
follower-state being redundantly duplicated 7 times (probably so
that `$16,x` doubles as the slot's flock-position without needing a
secondary lookup).

The walk-script driver `CODE_0CFAED` (used by state $00 idle and
states $01-$07 idle) reads a 4-byte X-pos table `DATA_0CFA5E` (mod
`$10 & 3`) for sub-positioning, and a 4-byte timer table
`DATA_0CFA66` (`$0004,$0008,$000C,$0010`) for tick budget. The 8
per-flock anim scripts at `DATA_0CFA2B` are 24-byte each, structured
as (anim-frame, X-offset, Y-offset) triples.

---

## 5. Goal Ring + GOAL Letters + Bonus Challenge Sign

These three sprites together drive the level-clear sequence.

### 5.1 Goal Ring ($00D)

The classic end-of-level hoop. Init issues **three separate**
`FXCODE_088619` calls -- but each call points at a **different**
FXDATA source pointer, NOT the same source-pointer at three
quadrants. The three calls are:

1. Top-left "ring upper-left half" graphic: source `FXDATA_540000+$4010`, position `(DATA_03A9CE[dyntile_slot], DATA_03A9EE[dyntile_slot])`, MULT `$0099` (slightly compressed), MERGE-Y / MERGE-X both `$0008`.
2. Top-right "ring upper-right half" graphic: source `FXDATA_550000+$60E0` (different FXDATA bank), position offset by +$0010 X, MULT `$0100` (no compression). The bank-$55 source is the larger top-half tilemap.
3. Bottom-left "ring lower-left half" graphic: source `FXDATA_540000+$3040`, position offset by +$0010 Y, MULT `$0099` again.

The ring is composed of three separate tilemap chunks (TL half, TR
half, BL half), drawn back-to-back to assemble the visible
*open-at-bottom-right* hoop shape. The "missing" bottom-right
quadrant is intentional -- the hoop has an opening through which
Yoshi enters, which is why the Goal Ring is drawn as an open arc
rather than a closed circle.

The Main is a 4-state machine `DATA_goal_ring_state_ptr` ($02:A8E0)
indexed by `$18,x`:

| `$18,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_goal_ring_state_00_spin_watch` | **Watch for Yoshi pass-through.** Per frame: compute X-delta = `!EXRAM_YI_Player_XPosLo - $70E2,x - $0018`. Look for an EOR sign-flip between this frame and last frame's $76,x. If the player has the "carry-flag" bit set (`$61B2 BMI`) and Y-distance is within $50, fire the activation: stamps `!Define_YI_PlayerState14_ActivateGoal` into the player-state, plays music $05, queues `SoundID3B_Pop`, sets `$60DE = $0006` (anim-timer), zeros several camera-state bytes including `$0C1E = 0001` (camera-frozen flag), and advances `$18,x`. |
| `$01` | `CODE_goal_ring_state_01_activate_goal` | **Ring-flash + force PlayerState02_InCutscene.** First entry: pin player state to `$02`, allocate a Yoshi-at-goal slot via `CODE_03A34E` (passive-init spawn of sprite $008C at player X / player Y + $0008), set carry-stack overrides, copy player position to the goal-tally position. Subsequent entries: while sound-cue $0002 (Yoshi-grunt), arm a $FD40 Y-velocity launch. Continues until `$0C23` (Layer1 X scroll target) reaches `$7E1A` (final goal X). |
| `$02` | `CODE_goal_ring_state_02_award_items` | **Show collected-items tally + scroll camera.** Counts down `$7A96` from $0180; at $50 spawns the `$00E GOALLetters` slot (single spawn -- one slot represents all 4 letters; the FX routine `FXCODE_09ACDA` renders them all). At $40 starts forcing camera Y-velocity at `$617A = $0200`. Iterates a one-shot $8-tick cycle that calls `CODE_029BD9` (the per-item bonus-bouncer that walks the inventory and bounces each collected item). |
| `$03` | `CODE_goal_ring_state_03_handoff_to_yoshi_at_goal` | **Hand-off to YoshiAtGoal sprite.** Spawns ambient sparkles ($1DF) every 4 frames. Sets `$60BE = $004C` (the "Yoshi pumps arm" anim frame). After $7A96 expires: scrolls camera right to final position, sets `$0D27 = 0006` (bonus-game phase entry), increments `$0B57 += 2` (level-clear flag). Eventually `JSL CODE_03A31E` x2 to despawn both the goal ring and the linked YoshiAtGoal. |

### 5.2 The flower-roulette + per-item award mechanism

State $02's per-item bouncer (state-array indexed via
`$7DF6` / `$7DF8`, the active-sprite-slot lists) walks each alive
sprite-slot of "collectible-item type" (`SpriteID - $022 = 0..9`)
and dispatches to a 10-entry pointer table `DATA_goal_award_per_item_ptr`
($02:A9B7):

| Offset (SpriteID - $022) | Handler | What it does |
|--------------------------|---------|--------------|
| $00 ($022 FlashingEgg) | `CODE_goal_award_flashing_egg` | Spawn a `$115 Coin` at the egg's position with `$FE80` Y-velocity, run a bounce arc. The "flashing egg = coin" payoff. |
| $01-$03 ($023/$024/$025 colored eggs) | `CODE_02A981` | Stop music, increment `$0B59` / `$0B7B` (clear flags). No demo bounce -- just clears the flow flag. |
| $04 ($026 BowserFight giant egg) | `CODE_goal_award_giant_egg_trio` | Spawn 3 stacked $115 coins via `$00:00` stack tracking. |
| $05 ($027 Key) | `CODE_goal_award_key` | Call `CODE_02A4F4` ("key-clear-level" handler) then run the FlashingEgg bounce. |
| $06 ($028 HuffinPuffin) | `CODE_goal_award_huffin_puffin` | Set Y-velocity to `$FB00` (big jump). |
| $07 ($029 unused) | `CODE_02A981` | RTS placeholder. |
| $08-$09 ($02A/$02B Red/Green giant eggs) | `CODE_goal_award_giant_egg_trio` | Same as $026. |

The "flower-roulette" mechanic implied by `DATA_02A5ED` /
`DATA_02A601` / `DATA_02A60D` works like this. The Goal Ring's main
body (lines $02:A663-$02:A8DD) drives a **deterministic** roulette,
NOT a true RNG:

- `DATA_02A5ED` is a 10-entry bitmask table (`$0001,$0002,$0004,$0008,$0010,$0020,$0040,$0080,$0100,$0200`). Each entry OR'd into `!EXRAM_YI_Level_NorSpr_GenericTable701902` lights up one of the 10 flower-tally "slots" in the ring's display.
- `DATA_02A601` is a 6-entry per-flower-count table (`$0000,$0200,$0280,$02A0,$02A8,$02AA`) -- the bonus-spin SuperFX program length, biased by `!RAM_YI_Level_FlowersCollectedLo`. **Zero flowers = $0000 ticks (no roulette).** One flower = $0200. Five flowers = $02AA. The roulette duration scales **non-linearly with flower count** -- more flowers = slightly longer spin, but the curve flattens at the top (a 5-flower clear gets a $02AA spin, only $02 more than 4-flower's $02A8).
- `DATA_02A60D` is a 10-entry sound-cue table for the Thunder Lakitu attack sounds played as the roulette ticks down. The entries are `SoundID51,SoundID52,SoundID53,SoundID54,SoundID55,SoundID56,SoundID55,SoundID54,SoundID53,SoundID52` -- a 6-tone "up-down" pattern (1-2-3-4-5-6-5-4-3-2). The 7th tone slot intentionally repeats `SoundID55` not `SoundID57`, giving the chime a triangle shape.

The bonus selection itself happens elsewhere. The goal ring's job is
just to provide the camera lock, the spin animation, and the
per-item visualization. The actual "which bonus game" decision is
in the bonus-game host (`gm2a_load_bonus_game` at Bank10:3273)
which reads `!RAM_YI_Level_DoBonusChallengeFlagLo` to know whether
to skip into a bonus or directly to the world map.

### 5.3 GOAL Letters ($00E)

**Single slot represents all 4 letters.** This is the key insight
about how the GOAL banner works: the engine spawns ONE `$00E` slot
when the goal-ring's state-$02 hits the right timing; the SuperFX
routine `FXCODE_09ACDA` reads the slot's `$18,x`, `$19,x`, `$76,x`,
`$77,x` control bytes (mapped to `REGISTER_SuperFX_R5/R6/R9/R10`) and
renders all 4 letters from that one slot's state.

Init (`init_GOAL_text` at $0F:8000):

- Stamps `$18,x = $05` -- this is the **letter phase**, NOT a phase
  pointer index. It's a countdown that the SuperFX routine reads as
  `R5` and uses to choose which subset of the 4 letters to render
  this frame (so the banner reveals letters one-by-one as the phase
  ticks down).
- Walks 14 palette entries (offset $1C..$00 in 2-byte steps) from
  `DATA_5FCC10` (the source palette) into BOTH `$702ECE` (paletted
  mirror at row $B1) and the auxiliary palette mirror. This seeds
  colors for the letter sprites -- the colors are stored at row $B1
  in palette RAM, which is the BG2 row used by the goal-letter
  rendering.

Main (`main_GOAL_text` at $0F:8019):

- Each frame: stamp `$70E2,x = $00E0 + Layer1XPosLo` and `$7182,x = $0020 + Layer1YPosLo` (lock to screen origin + $E0,$20).
- Push control bytes to SuperFX R5/R6/R9/R10 from slot fields $18/$19/$76/$77.
- Call `FXCODE_09ACDA`.
- Dispatch via `$16,x` through `DATA_0F8061` (4 entries):

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0F8069` | **Rise.** Each frame increment `$19,x` (Y-position) by 8 until >= $A0, then advance `$16,x` by 2 -> $02. |
| `$01` | `CODE_0F8082` | **Settle.** Decrement `$19,x` by 4 until < $80; on trigger pin `$19,x = $80`, arm `$7A96 = $40`, advance. (Unreachable on standard flow since state $00 advances to $02 directly via `$16,x += 2`, not state $01.) |
| `$02` | `CODE_0F80A0` | **Hold / idle.** Wait until `!RAM_YI_Level_DoBonusChallengeFlagLo == 0`. Each tick, when `$7A96` reaches 0, increment `$77,x` (capped at $40 -- the rotation angle for the SuperFX render), and increment `$76,x` by 4 (the letter-color cycle). |
| `$03` | `CODE_0F80CD` | **Sparkle finale.** Walks `$18,x` countdown from 5 to 0. At each tick: read a per-letter X-offset from `DATA_0F80C3[$18]` (5-byte table `$0008,$0014,$0014,$0014,$0014`), spawn an `$1CD` sparkle ambient sprite at Goal-X minus offset, queue `SoundID36_CollectFlower`, arm a $08-frame inter-letter delay. When `$18,x` hits -1, `JML CODE_03A31E` -- despawn the GOAL letters slot. |

So `$16,x` is the phase, `$18,x` is the letter-phase countdown,
`$19,x` is the per-letter Y target, `$76,x` is the cycling color
index, `$77,x` is the per-letter rotation angle (capped at $40).

### 5.4 Bonus Challenge Sign ($00F)

Smaller-scope sprite -- the "BONUS CHALLENGE" or "BONUS" sign that
appears when entering a bonus game.

Init (`init_BONUS` at $0F:8135):

- Snapshot Layer1XPosLo to `$78,x` (the sign's screen-X anchor).
- Set `$70E2,x = LayerXPosLo + $0080` (center horizontally).
- Set `$7A36,x = $70E2,x` (also center -- used as the swing target).
- Set `$7182,x = LayerYPosLo - $0040` (off the top of the screen).
- Stamp `$18,x = $02`.
- Walk 14 palette entries (offset $1C..$00 in 2-byte steps) from
  `DATA_5FCBF2` into `$702F2E` (palette row $E1). The "BONUS"
  letter colors.
- Queue `SoundID95_BonusChallenge`.

Main (`main_BONUS` at $0F:8174):

- Every frame call `FXCODE_09AE83` (with `DATA_0F8276` -- the
  per-letter glyph table) to render the sign.
- Run `CODE_0F822B` -- the **per-frame palette cycler.** Every 8
  frames, advance the "S" gradient color through 9-entry table
  `DATA_0F8219` and the lettering shadow color through 4-entry
  `DATA_0F8211`. This is what makes the BONUS sign shimmer.
- Dispatch via `$16,x` through `DATA_0F819F` (4 entries):
  - States $00 and $01 share `CODE_0F81AF` -- play a flute sound from
    `DATA_0F81A7[$16,x]` (`$0021,$0022`), set `$0CF9` from
    `DATA_0F81AB[$16,x]` (`$D000,$D400`), arm $20-frame hold timer.
  - State $02 (`CODE_0F81CA`): wait for `$7A96` to expire; on tick,
    set Y-velocity to `$0800` and acceleration `$0040` -- the sign
    starts falling.
  - State $03 (`CODE_0F81E4`): per-frame, compute sign's screen-X
    from `$78,x - Layer1XPosLo + $7A36,x` (center-on-camera with the
    designer's offset). When Y reaches `Layer1YPosLo + $0050`,
    advance through 3-entry Y-velocity table `DATA_0F816E`
    (`$0000,$FE00,$FC00`) to bounce the sign upward, then settle.

Note: the sign has **no explicit despawn path**. It's expected to
live as long as the bonus-game gamemode (gm2A/gm2C) -- the gamemode
exit `CODE_clear_all_sprites` cleans it up.

---

## 6. Middle Ring ($04F)

The level checkpoint. Conceptually similar to a goal ring but
**non-terminating** -- it just sets the checkpoint flag for level
restart-from-midpoint.

Init (`init_middle_ring` at $02:9383):

- Call `CODE_03D406` -- the **checkpoint marker registration.** This
  registers the sprite's slot in the slot-table at `$01:E550`+
  region so that on level death the engine knows which middle ring
  was last touched. Allocates the SuperFX dyntile slot for the ring
  sparkle.
- Set `$7A36,x = $0020` (initial sparkle phase -- the ring is in its
  pre-touched "sleeping" animation).

Main (`main_middle_ring` at $02:938E):

- Per frame: render sparkle via SuperFX `FXCODE_08D3F9` (a small
  rotating-ring graphic). Slot's `$76,x` is the rotation angle (auto-
  incremented), `$78,x` is the per-frame palette index (cycles 0..5
  via the increment-and-CMP pattern), `$7A36,x` is the radius (set
  to $20 on Init).
- Check `$18,x` (touched flag). If non-zero, jump to the post-touch
  branch `CODE_029461`.

Pre-touch branch (`CODE_0293D6`):

- Call `CODE_03AF23` (freeze-aware tick).
- Hit-test Yoshi: check `$7C16,x + $20` against $41 (X within +-32),
  then `$7C18,x + $38` against $89 (Y within +-56) OR `$7C18 + $28`
  against $46 (Y within +-40). Two Y-test windows because the
  sprite's collision box is taller than wide.
- On Yoshi-contact: stamp `$7400,x` with Yoshi's facing-direction
  (`$77C2,x`). If the level is `!Define_YI_LevelID_WatchOutBelow`
  (the first level with a midpoint) AND the tutorial flag for
  "first midpoint hit" hasn't been set, set the flag and trigger
  msgbox $27 (the "you touched a midpoint" tutorial).
- Set both freeze flags (`!EXRAM_YI_Level_FreezeYoshiFlagLo` +
  `!EXRAM_YI_Level_FreezeSpritesFlagLo`).
- Stamp `$7A98,x = $0008` (cooldown timer) and advance `$18,x`.
- Add $0064 to `$0396` (the player's score adder -- 100 points for
  hitting a midpoint).
- Set `$0B7F = $00DC` (the music-cue ID for the midpoint chime).

Post-touch branch (`CODE_029461`):

- Wait for msgbox to close (`!RAM_YI_Level_MessageBoxState == 0`).
- Decrement `$7A98,x` (animation cooldown). On expiry: advance
  `$7A36,x` (the sparkle radius) by $0002. The radius progression
  is: $20 -> $22 -> ... and the per-radius palette is picked from
  4-entry `DATA_029459` (`$0013,$0021,$002F,$003D`, indexed by
  `(radius >> 4)`).
- On radius reaching $60: clear freeze flags, call `CODE_03D3EB`
  (commit the checkpoint marker) and `CODE_029507` (snapshot level
  state to `$7E79A6` / `$7E7BB0`), then `CODE_despawn_sprite_free_slot`.

The persistence mechanism: `CODE_029507` ($02:9507) writes the
current sprite-state table (`$03B2,x` -> `$7E79A6,x` for 0x20E bytes)
and the active-sprite-slot list (`$7DF6` -> `$7E7BB0`). On level-
restart from midpoint, these bytes are reloaded by the level-loader
to restore the world state at the moment of the checkpoint touch.

The increment of `!RAM_YI_Level_MiddleRingsTouchedLo` in `CODE_029507`
also gates the "perfect 30-star clear" -- to get the 100% rating,
Yoshi must avoid touching the middle ring.

---

## 7. Yoshi at Goal + End-of-level Yoshi ($08C, $098)

Two very different post-clear actors.

### 7.1 Yoshi at Goal ($08C)

The static Yoshi sprite shown bouncing during the post-goal score
tally screen.

Init (`init_yoshi_at_goal` at $02:AC75):

- Try to allocate a dyntile slot via `CODE_03AD74`. If allocation
  fails (BCS branch), bail out and let the slot stay alive as a
  no-render placeholder until a slot frees up.
- Stamp `!EXRAM_YI_Level_NorSpr_CurrentStatus = $0002` (alive,
  rendering-allowed).

Main (`main_yoshi_at_goal` at $02:AC86):

- Read Yoshi's current color from `!RAM_YI_Level_CurrentYoshiColorLo`,
  shift it to a graphics-bank offset, stamp into `$6116` (the
  Yoshi-graphics-source byte).
- Call `CODE_04FB41` (the per-frame Yoshi-graphics-fetch).
- Call `CODE_03AA52` (dyntile-direct render).
- Call `CODE_03AF23` (freeze-aware tick).
- Call `CODE_03A590` (apply Y-velocity / gravity).
- On floor (`$7860 & $0001`): zero X-velocity. Wait for `$7A96 == 0`,
  then arm `$FD80` Y-velocity (the cheer hop) and reset `$7A96 = $18`.
- Render via SuperFX `FXCODE_088293` with one of two
  `REGISTER_SuperFX_R12` ptrs from `DATA_02AC82`:
  - On-floor pose: `FXDATA_550000 + $6080`.
  - In-air pose: `FXDATA_550000 + $60A0`.
- Both use MULT `$0100` (no scaling) and MERGE-X/MERGE-Y both $0010.

The fixed Y-velocity `$FD80` is the same as other Yoshi cheer hops
in the engine, but the `$18` cooldown is shorter than most other
hop cycles ($18 = 24 frames vs the typical $30) -- Yoshi at Goal
hops at roughly 1 Hz.

### 7.2 End-of-level Yoshi (EndTransformationBlock $098)

The Yoshi-shaped block that appears at the end of any transformation
(skis/helicopter/mole-tank/etc) sub-section. The block halts the
transformation, restores normal Yoshi, and acts as a sub-goal marker.

Init (`init_yoshi_block` at $05:B6DE):

- Bail if `$61F4 == 0` (no transformation active) OR `$0C8A == 0`
  (level not in normal state). Sets `$76,x = $03` (idle-stub state)
  and `$74A2,x = $00FF` (no dyntile -- block remains drawn as
  static Map16, not a sprite).
- If transformation IS active: spawn a `$1E6` ambient puff at
  player position. Allocate dyntile via `CODE_03AE60`. Stash own
  X/Y in `$18,x` / `$78,x` (sweep-volume anchor). Initialize `$7400,x`.
- Set up SuperFX render call:
  - `R12 = FXDATA_548000 + $60C0` (the Yoshi-block tilemap).
  - `R6 = $0100`, `R8 = $0010`, `R9 = $0000`.
  - Position from `DATA_03A9CE[$7722,x]` / `DATA_03A9EE[$7722,x]`.
  - Call `FXCODE_088293`.

Main (`main_yoshi_block` at $05:B75A):

- Call `CODE_03AA52` (dyntile-direct render).
- If any freeze flag is set, call `CODE_03B69D` (freeze-handler).
- Watch for player state == `PlayerState18_SentTowardsBabyMario`
  (the "I just transformed back" cue). On hit: branch to clean-up.
- Otherwise dispatch via `$76,x` ASL -> TAX -> JSR through
  `DATA_yoshi_block_ptr` ($05:B754). State $03 has a special
  branch: if `$61F4 != 0` AND `$0C8A != 0`, re-trigger Init via
  `JML CODE_05B6F3` (the "transformation just started" path).
- Call `CODE_05B88C` for the sweep-volume intersection test using
  `FXCODE_0B8578` (SuperFX intersection algorithm). On hit-true:
  copy player Y to `$7E16`, set freeze flags, queue `SoundID20_SoaringEgg`.

The 3 substantive states (state $00 idle-stub `CODE_0580C2` is
literally an RTL):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0580C2` | RTL placeholder. |
| `$02` | `CODE_05B7D1` | **Dispense.** Per frame: lerp the block toward its sweep-volume's anchor (`$18,x` for X, `$78,x` for Y) via the X/Y-velocity-sign-flip pattern; on convergence (`|delta| < 8`), pin position, zero velocity. When `$0C8A != 0` (level still active): arm Y-velocity `$FC00` (block pops up), arm gravity `$0080`, queue `SoundID1C_StompEnemy`, advance `$76,x` to $04. |
| `$04` | `CODE_05B85A` | **Cleanup.** Wait for `$7A98` to expire. Spawn `$1D4` ambient sprite (the puff). `JML CODE_03A31E` -- despawn. |

So the block is the **transformation reverse-trigger**: once Yoshi
reaches it in transformed-form, the block's main body sets the player
state to send Yoshi home, locks the camera, plays the sound, and
despawns.

---

## 8. Game-mode integration

Each cinematic actor is hosted by a specific game-mode (the global
`!RAM_YI_Global_CurrentGameMode`) or by a specific level-mode (the
per-level `!RAM_YI_Level_LevelHeaderLevelModeLo` byte in the level
header).

### 8.1 Prologue: gm38 / gm39 + level-mode 9

- **`gm38_load_intro_cutscene` (Bank10:10619).** One-shot setup:
  loads tilemaps + graphics, primes BG3 (the storybook text BG),
  sets `!Define_YI_PlayerState1C_Prologue` to disable Yoshi input,
  spawns 8 `$12D PrologueCutsceneYoshi` slots at fixed positions
  from `DATA_10D9EF / DATA_10D9FF`.
- **`gm39_intro_cutscene` (Bank10:10888).** Per-frame driver,
  dispatches via `$0D27` (phase pointer) through
  `DATA_intro_cutscene_phase_ptrs` ($10:DC9B) -- a 9-entry pointer
  table covering text-scroll / stork-delivery / Bowser-kidnap / etc.
- The `$061 BabyMario` slot is spawned by gm38 at the same time as
  the Yoshi flock, but his per-frame body runs through the
  **level-mode-9** path (the `CODE_06CA2D` dispatcher in §2.2),
  NOT through the normal off-Yoshi state machine. So `$061` has
  two different host-driven entry points to its non-mounted body:
  - Level-mode $0009 (prologue) -> 5-state level-mode-9 machine
  - All other level-modes -> 15-state main machine

### 8.2 Goal-clear sequence: gamemode increments via $0B57 / $0B59

The goal-clear sequence doesn't have its own gamemode handler.
Instead, the Goal Ring's state-machine main body increments
`!RAM_YI_Global_CurrentGameMode` directly in state $00:

```
INC.w !RAM_YI_Global_CurrentGameMode  ; CODE_02A916+
INC.w $0B57                            ; "level-clear pending" flag
```

And later in state $03:

```
INC.w $0B57         ; advance level-clear flag
INC.w $0B57
```

So `$0B57` cycles 0 -> 1 (touched) -> 2 -> 3 -> 5 -> 7 as the goal
sequence progresses. At `$0B57 == 5`, the post-clear hand-off into
the bonus-game gamemode happens. At `$0B57 == 7`, the post-bonus
score tally ends and the global gamemode advances past goal.

Note that this works **without** a "goal-host" gamemode handler --
the Goal Ring sprite IS the host. As long as its slot is alive, the
sequence is gated. Once the ring `JML CODE_03A31E` despawns in state
$03, the level-clear is committed.

### 8.3 Bonus game: gm2A / gm2B / gm2C + per-game slot init

- **`gm2A_load_bonus_game` (Bank10:3273).** Loads bonus-game arena
  (one of 6 variants picked from `DATA_109A88 / DATA_109A94 / ...`
  by `!RAM_YI_Level_CurrentBonusGame`). Spawns `$061 BabyMario` at
  fixed position $20,$00B8 (the "Mario in his bubble" position
  used in many of the bonus games).
- **`gm2B` (transition fade).**
- **`gm2C_bonus_game` (Bank10:3922+).** Per-frame bonus-game driver.
  The actual mini-game (raffle, slot machine, scratch card, etc.)
  has its own per-game state machine; Baby Mario participates as a
  scripted actor on his level-mode-9 path.
- The **`$00F BonusChallengeSign`** is placed into the bonus-game
  arena's sprite list, runs its 4-state main as long as the gm2C
  gamemode is active.

### 8.4 Ending: gamemode $26 + post-Bowser flow

The Bowser-ending cinematic uses gamemode $26 (ending) which hosts:

- **`$040 BabyLuigi`** -- runs his 2-state main once player approach
  triggers state $02.
- **`$041 Stork`** -- placed in the ending-level's sprite list,
  runs the 3-state delivery flow.
- A post-ending **`$061 BabyMario`** slot is also active, but on
  the standard 15-state body (not level-mode-9) since the ending
  level-mode is NOT $09.

### 8.5 Mid-level cinematics

Several mid-level cinematics use these cinematic actors without a
dedicated gamemode handler -- they piggy-back on regular gameplay:

- **Mid-level Kamek-bubble loss.** When Yoshi takes a hit from
  certain enemies, Baby Mario flies off in his bubble. The `$061`
  sprite is already alive; the engine just toggles `$0B59 = 0` to
  break out of `riding_baby_mario` and start the 15-state off-
  Yoshi flow.
- **Boss-defeated key-grab.** Triggers `PlayerState02_InCutscene`
  for Yoshi while the boss-arena's `$014 KeyFromBoss` runs its
  5-state machine (see `docs/family-kamek.md` §6 for that sprite).
- **Goal-tally per-collected-item bounce.** State $02 of the Goal
  Ring walks the sprite list looking for items of types $022-$02B
  and runs each through its bounce demo. This is the "I collected
  this item, watch it bounce" effect on the post-clear summary.

---

## 9. Cross-references

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_main`, etc.) that runs each cinematic actor's main
  body every frame. The freeze-aware-tick `CODE_03AF23` is invoked
  by most cinematic actors at the top of their Main.
- `docs/leveldataengine.md` -- how level-data sprite-list entries
  spawn the cinematic actors (Stork / BabyLuigi placed by designer;
  Middle Ring + Goal Ring placed by designer).
- `docs/family-kamek.md` -- `$053 KamekSayingOhMy` and the broader
  Kamek cinematic family. The boss-cinematic vocabulary
  (`$1015` handshake, `$048` CutsceneKamek) is documented there
  and is parallel to the goal-clear sequence here.
- `docs/bossengine.md` -- the post-boss key-grab sequence (`$014`)
  parallels the goal-ring item-tally pattern; the goal-area state
  machines borrow the same `PlayerState02_InCutscene` freeze trick.
- `docs/family-eggs.md` -- the `$022/$023/$024/$025` egg sprites
  that the Goal Ring's `goal_ring_state_02_award_items` bounces.
- `docs/enginecore.md` §3 -- the gamemode dispatcher that hosts the
  prologue (gm38/gm39), bonus-game (gm2A/gm2C), and ending (gm26).
- `yi/Banks/Bank02.asm` -- `init_middle_ring` (line 1811), `main_middle_ring`
  (1827), `init_goal` (4052), `main_goal` (4139),
  `init_yoshi_at_goal` (4882), `main_yoshi_at_goal` (4895),
  `DATA_goal_ring_state_ptr` (4450),
  `DATA_goal_award_per_item_ptr` (4555), per-item award handlers
  (4569+), checkpoint state-snapshot routine `CODE_029507` (2017).
- `yi/Banks/Bank05.asm` -- `init_yoshi_block` (7554),
  `main_yoshi_block` (7612), `DATA_yoshi_block_ptr` (7607),
  Stork-end-of-flight checks (15946, 16231).
- `yi/Banks/Bank06.asm` -- `init_baby_mario` (6811),
  `main_baby_mario` (6846), `riding_baby_mario` (8942),
  `DATA_baby_mario_main_state_ptr` (6821), 15-state body
  (CODE_06C32B through CODE_06C812), level-mode-9 body
  (`CODE_06CA2D` at 8414+),
  `DATA_baby_mario_levelmode9_state_ptr` (8406),
  Kamek-bubble carrier-list `CODE_06C237` (7484), per-carrier
  payload dispatch `CODE_06C189` / `CODE_06C16E` / etc.
- `yi/Banks/Bank0C.asm` -- `init_yoshi_in_intro_cutscene` (15474),
  `main_yoshi_in_intro_cutscene` (15494),
  `DATA_prologue_yoshi_state_ptr` (15502), per-slot OAM-attr table
  `DATA_0CFA3B` (15467), 8-script anim-table dispatch table
  `DATA_0CFA2B` (15464).
- `yi/Banks/Bank0F.asm` -- `init_GOAL_text` (67),
  `main_GOAL_text` (90), 4-phase ptr `DATA_0F8061` (131),
  `init_BONUS` (257), `main_BONUS` (293), `init_stork` (833),
  `main_stork` (854), 3-state ptr `DATA_0F8669` (861),
  Stork anim tables `DATA_0F864F` / `DATA_0F8655` / `DATA_0F865B`
  (841-848), `init_baby_luigi` (1852),
  `main_baby_luigi` (1890), 2-state ptr `DATA_0F8DC1` (1900),
  30-step anim tables `DATA_0F8D57` / `DATA_0F8D75` /
  `DATA_0F8D93` (1875-1885), per-slot palette seeder
  `CODE_0F8D44` (1863), per-letter palette source `DATA_5FCC10`
  (referenced from $0F:8006), `DATA_5FCBF2` (referenced from $0F:8154).
- `yi/Banks/Bank10.asm` -- `gm38_load_intro_cutscene` (10619),
  `gm39_intro_cutscene` (10888),
  `DATA_intro_cutscene_phase_ptrs` (10871),
  prologue Yoshi flock-position tables (referenced as
  `DATA_10D9EF` X coords, `DATA_10D9FF` Y coords),
  `gm2A_load_bonus_game` (3273), bonus-game $061 spawn (3365).
- `yi/Banks/Bank03.asm` -- `CODE_03B7BB` Stork hand-off path (7669;
  spawns fresh `$061 BabyMario` slot when the Stork "delivers"
  Mario back to Yoshi at end of prologue).
- `yi/Banks/Bank04.asm` -- `CODE_04DC28` standard `$061 BabyMario`
  level-start spawn (11725-11748).
- `yi/Banks/Bank17.asm` -- `SoundID9F_StorkFlappingWings` reference
  at the world-map stork flight handler (1692) -- this is a
  **different** stork (a worldmap traversal sprite, not the same
  level-mode actor).
- `yoshisisland-disassembly/disassembly/bank06.asm` -- Raidenthequick's
  descriptive labels: `init_baby_mario`, `main_baby_mario`,
  `riding_baby_mario`.
- `yoshisisland-disassembly/disassembly/bank02.asm` -- `init_goal`,
  `main_goal`, `init_middle_ring`, `main_middle_ring`,
  `init_yoshi_at_goal`, `main_yoshi_at_goal`.
- `yoshisisland-disassembly/disassembly/bank05.asm` -- `init_yoshi_block`,
  `main_yoshi_block`, `DATA_yoshi_block_ptr`.
- `yoshisisland-disassembly/disassembly/bank0F.asm` -- `init_stork`,
  `init_baby_luigi`, `main_baby_luigi`, `init_GOAL_text`,
  `main_GOAL_text`, `init_BONUS`, `main_BONUS`.
- `yoshisisland-disassembly/disassembly/bank0C.asm` -- `init_yoshi_in_intro_cutscene`,
  `main_yoshi_in_intro_cutscene`.
- `ys_chr.asm` -- parallel asm for the character/cutscene actor
  family (Baby Mario / Baby Luigi / Stork). Shares the structure
  but uses different per-step animation table sizes.
- `ys_play.asm` -- player state $14 (ActivateGoal), $18
  (SentTowardsBabyMario), $1C (Prologue), $24 (pipe-exit-pop).
  All four are pinned by handlers in this doc.
- `ys_game.asm` -- gamemode dispatcher. Hosts gm38/gm39/gm26/gm2A/gm2C
  which in turn host the cinematic actors here.
- `ys_enmy.asm` -- minor parallel for the carrier dispatch at
  `CODE_06C189` (Toady "I-grabbed-Mario" path).

---

## 10. Open questions

- **Q1: Goal Ring -- which exact tilemap chunks are which?** Init
  issues three `FXCODE_088619` calls with three different FXDATA
  source pointers (`FXDATA_540000+$4010`, `FXDATA_550000+$60E0`,
  `FXDATA_540000+$3040`). The first and third are bank-$54 sources
  with MULT `$0099`; the middle one is bank-$55 with MULT `$0100`.
  Resolving the exact "TL/TR/BL" attribution requires inspecting
  the FXDATA bytes themselves (out of scope for an asm-only doc).
  Open: does the bank-$55 chunk render the "Goal" text inside the
  hoop, or the upper-right ring arc itself? Both interpretations
  are consistent with the visible asset.

- **Q2: Why is the prologue Yoshi state-table 8 entries with 7
  duplicates?** `DATA_prologue_yoshi_state_ptr` ($0C:FA77) has
  CODE_0CFA87 at index 0 and CODE_0CFAB0 at indices 1-7. The
  redundancy means slots 1-7 read the same handler 7 times. Is this
  for cache-line alignment (assembler padding), or does
  CODE_0CFAB0 do something subtly different based on the secondary
  state-byte `$76,x`? Reading the handler shows it only branches
  on `!EXRAM_YI_Player_XPosLo >= $01C8`, suggesting genuine
  redundancy. Likely an artifact of preserving the table size for
  consistency with other 8-entry state tables (e.g.,
  `DATA_woozy_guy_state_ptr` has 6 entries with similar pattern).

- **Q3: Stork's `DATA_0F864F` Y-velocity reuse.** The 6-byte table
  `db $02,$00,$02,$00,$02,$00` is used as an anim-frame index in
  state $02 of the main, but its name suggests Y-velocity.
  Investigation showed it's purely an anim index (frame $02 =
  flap-down, frame $00 = flap-up), and the stork has no Y-velocity
  field (the world scrolls past). Why was the name "Y-velocity"
  applied? Probably a documentation hangover from the post-Bowser
  Mario-return arc where the stork DID have an actual Y-velocity
  component -- that arc uses `DATA_05F94B` (Bank05) instead, which
  is genuinely a Y-velocity table. The two storks (intro vs
  post-Bowser) share the sprite ID but have different host code
  paths.

- **Q4: What's the actual "first-midpoint tutorial" trigger
  level?** `init_middle_ring` checks
  `!RAM_YI_Level_CurrentLevelFromMapLo - 1 == 0` (i.e., level
  $0001 = `!Define_YI_LevelID_WatchOutBelow`) before showing
  msgbox $27. But `WatchOutBelow` is actually `!Define_YI_LevelID_WatchOutBelow`
  in `Constants/LevelIDs.asm`. The implementation matches the
  designer's intent: only level 1-1 shows the "midpoint tutorial"
  message. Edge case: if a hack adds a middle ring to an earlier
  bonus-game level, would the tutorial flag fire? Doesn't matter
  in vanilla YI (no bonus-game has a middle ring), but the check
  `CurrentLevelFromMapLo - 1 == 0` is a tight bound.

- **Q5: Baby Mario's 15-state machine, are all 15 reachable?**
  States $02 and $04 share the same handler `CODE_06BCC6` (bare
  RTL). State $00 is the "drift in bubble" state. State $01
  branches to re-mount setup, which then resets `$76,x = 0`
  via `STZ.b $76`, so state $01 is **transient** -- never lives
  past one frame. Looking at all 15: $02 and $04 are stubs. $07
  is the "wait for `$7223` thaw" state. $0D appears to be the
  same handler body as $08 / $0A. Realistically, ~10 of the 15
  entries are unique behaviors; the others are stubs or shared
  bodies indexed for state-machine bookkeeping. The 15-entry size
  is likely chosen to give comfortable index room (so that
  Mario's `$76,x` byte values can also encode some flags in the
  upper bits without colliding with a real state index).

- **Q6: Goal Ring's flower-roulette: deterministic, but with
  what perceived randomness?** `DATA_02A601` ($0000, $0200, $0280,
  $02A0, $02A8, $02AA) gives spin-duration per flower count. With
  no flowers -> 0 spin time (instant deterministic result -- you
  get the "no bonus" outcome). With 5 flowers -> $02AA = 682 ticks.
  The roulette **stops** when the LOOP counter R12 reaches zero
  inside the SuperFX program, at which point the current bit
  position in the `DATA_02A5ED` mask is the chosen bonus. So the
  bonus is **deterministic based on flower count + start frame** --
  player can theoretically game it by timing the goal-ring touch.
  This is consistent with speedrunner reports that flower-bonus
  selection can be manipulated via frame-perfect goal touches.

- **Q7: EndTransformationBlock SuperFX intersection test.**
  `CODE_05B88C` uses `FXCODE_0B8578` with $0E00/$1000 source/dest
  registers and a sweep-volume against the player's collision box.
  The exact semantics of $603C/$603E/$6036/$6038/$603A as
  sweep-volume parameters need to be cross-referenced with
  `docs/mchip.md` §5 (SuperFX intersection algorithms). Likely a
  4-corner-vs-AABB test with the block's sprite as the test source
  and Yoshi's collision box as the static volume.

- **Q8: GOAL-letter slot count -- exactly one or one per letter?**
  Reading `goal_ring_state_02_award_items` at $02:AB7E: `LDA #$000E;
  JSL CODE_spawn_sprite_init`. One slot. The SuperFX routine
  `FXCODE_09ACDA` reads control bytes from R5/R6/R9/R10 and renders
  all 4 letters from that single slot's state. Confirmed by reading
  `init_GOAL_text` which seeds palette for ALL 4 letter rows from
  a single slot. No second `$00E` slot is ever spawned. So the GOAL
  banner is a single-slot, multi-letter SuperFX render.
