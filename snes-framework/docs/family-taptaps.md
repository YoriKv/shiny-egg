# YI Tap-Tap family reference

Standalone reference for the YI Tap-Tap variant family. Tap-Tap the Red
Nose (`$03C`) is a mid-boss in Bank0F with a full 18-state machine; the
smaller Tap-Tap variants (`$109` Bronze, `$10A` Silver, `$10B` Hopping
Silver) are common enemies in Bank0D sharing a 6-state machine. Companion
to `docs/bossengine.md` §7.2 (the boss-engine summary) and
`docs/spritestateengine.md` (the underlying per-sprite dispatcher).

The family is interesting precisely because the **boss and the regulars
have entirely separate implementations** -- Bank0F handles the boss with a
full intro/combat/death state machine; Bank0D handles the regulars with a
much simpler walk-bob-tongued state machine sharing only the visual
silhouette and the spike-ball motif. No code is shared between the two
banks. The Red Nose code is reused outside its boss fort as a tiny
"non-boss tap-tap" enemy via an internal `LevelID` branch in state $00.

Source of truth: `yi/Banks/Bank0F.asm` lines 3705-5188 (the Red Nose
boss), `yi/Banks/Bank0D.asm` lines 8389-8852 (the three smaller variants).
Cross-verified against `yoshisisland-disassembly/disassembly/bank0F.asm`
(28 `tap_tap_*` Raidenthequick labels for the boss) and
`yoshisisland-disassembly/disassembly/bank0D.asm` (`tap_tap_ai_pointers`,
`tap_tap_collision_x_knockback`, `tap_tap_tongue_x_knockback`,
`main_tap_tap` for the regulars). See also: `ys_boss1.asm`, `ys_boss2.asm`,
`ys_enmy*.asm`.

---

## 1. Family at a glance

### 1.1 ID table

| Sprite ID | Constant name | Bank | Init handler | Main handler | Role |
|-----------|---------------|------|--------------|--------------|------|
| `$03C` | `TapTapTheRedNose` | 0F | `$0F:9C0B` `init_tap_tap_the_red_nose` | `$0F:9C58` `main_tap_tap_the_red_nose` | The mid-boss. 18-state combat machine; Kamek-grown intro; lava-death cinematic. Stomp-vulnerable (single-stomp kill via $7862,x==$18). |
| `$109` | `BronzeTapTap` | 0D | `$0D:C171` `init_tap_tap` (shared) | `$0D:C1A5` `main_tap_tap` (shared) | Bronze (brown-palette) regular. Default 6-state walk + bob; can be hit by eggs / spat-shyguys / tongued; falls into pits. |
| `$10A` | `SilverTapTap` | 0D | (shared with $109) | (shared with $109) | Silver (gray-palette) regular. Identical state machine; visual variant only. Stays on ledges (won't fall off). |
| `$10B` | `HoppingSilverTapTap` | 0D | (shared with $109) | (shared with $109) | Silver Tap-Tap that periodically hops. Init pre-arms `$7402=$0D` and increments `$7A36` to flag the "hopping" sub-mode that drives state $00's jump branch. |

### 1.2 The Red Nose vs minis architectural split

The architectural divide is unusually clean for YI:

- **Bank0F's boss code** (`$03C`) is a full boss state machine with intro
  (Kamek growth + slow descent), combat (walk / turn / jump / land /
  hit-reactions), and death (4-stage lava sinking + explosion). State byte
  is `$105F` (16-bit boss-only WRAM slot) -- **not** the standard `$76,x`
  per-slot byte used by every other boss. Dispatched as
  `$105F * 2 -> JMP (DATA_tap_tap_state_ptr,x)`.
- **Bank0D's regulars code** (`$109/$10A/$10B`) is a 6-state machine on
  the standard per-slot `$76,x` byte, with the tongued / collision /
  recover entries that the broader sprite engine demands. No intro, no
  death sequence -- they die by single egg-hit or get eaten via the
  standard sprite-state-engine tongue path.

Beyond the spike-ball silhouette there's no shared code. The boss's
helper `CODE_tap_tap_check_yoshi_dir` (`$0F:A5FE`) sets Y=0 / Y=2 based on
Yoshi-X sign; the regulars' equivalent reads `$77C2,x` /
`$7400,x` (engine-maintained sprite-facing flags) directly. The boss
implements its own egg-hit collision test (`CODE_tap_tap_egg_hit_test` at
`$0F:A624`); the regulars use the engine-standard `CODE_03B25B`
projectile-handler path via the sprite-collision check in
`CODE_0DC273..0DC315`.

What the family DOES share is identity at the level-data layer
(`!Define_YI_NorSpr03C/109/10A/10B` are all "tap-tap-shaped"), plus two
sound IDs that are reused across both halves:

- `$0026 WalkingTapTap` -- the regulars' footstep on state $00 (frame 2).
- `$0084 TapTapTheRedNoseWalk` -- the boss's footstep, kicked from
  `CODE_tap_tap_state_ai_walk_forward` (state $05) every $10 frames.

The boss also has a death-specific sound chord (`$0047 Explosion`, `$0062
MelonBugBump` repeated during the rising lava convulsions, and `$007A
HurtNepEnut` on the single accepted head-bop that initiates death).

---

## 2. The Red Nose state machine (Bank0F)

Tap-Tap the Red Nose is implemented in `yi/Banks/Bank0F.asm` lines
3705-5188. Single sprite slot; intro + combat + death are all driven by
one 18-entry state-pointer table at `DATA_tap_tap_state_ptr`
(`$0F:9DC9`).

### 2.1 Dispatch shell (`main_tap_tap_the_red_nose`)

```
SEP #$20
JSR CODE_tap_tap_pre_dispatch_oam_setup    ; build per-frame OAM tile from anim ($1063)
REP #$20
JSL CODE_03AF23                            ; engine sprite-housekeeping (gravity / collisions / damage flash)
JSR CODE_tap_tap_state_dispatch            ; SuperFX rotate/scale per state ($7402,x gate)
SEP #$20
JSR CODE_0F9CA2                            ; per-frame timer ticks ($1060/$1061/$1069 DEC)
                                            ; egg-hit test (CODE_tap_tap_egg_hit_test)
                                            ; floor-land Y-cleanup
                                            ; off-screen X clamp (only if not in boss-fort)
LDA $7862,x : CMP #$18                     ; engine-set "head-bop accepted" flag
BNE skip                                    ;
  LDA #$7A : JSL push_sound_queue          ;   play HurtNepEnut
  LDA #!StopMusicCommand : STA $0B83       ;   silence boss music
  STZ $7862,x                              ;   consume the flag
  JSR CODE_tap_tap_spawn_lava_splash       ;   30 ambient lava splashes
  LDA #$0E : STA $105F                     ;   jump straight to death state
  LDA $6FA0,x : AND #$F9DF : STA $6FA0,x   ;   clear SuperFX render flags
  LDA $6FA2,x : AND #$FFE0 : STA $6FA2,x   ;   clear OAM priority bits
  STZ $7542,x                              ;   clear X-velocity
skip:
REP #$20
RTL
```

Key observations:

- The head-bop test (`$7862,x == $18`) is checked **after** state
  dispatch, so the just-dispatched handler runs one final time on the
  death-entry frame. This is why state $0E "death sinking" doesn't need
  to seed `$105F`/`$7542` itself.
- `$1015` (the **Kamek spell handshake** documented in
  `docs/bossengine.md` §10 Q3) is checked in `CODE_0F9D9F`: if positive,
  skip dispatch entirely and just set `$7A96,x = $40` (the "Kamek
  talking" pause). The boss seeds `$1015 = $0001` in state $00 to wake
  Kamek; state $01 zeroes it in the same handshake protocol.

### 2.2 State pointer table (18 entries)

| `$105F` | Handler | Phase | Behaviour |
|---------|---------|-------|-----------|
| `$00` | `CODE_tap_tap_state_intro_idle` | intro | Pre-boss idle. If level == TapTapTheRedNosesFort, just wait $7A96 timer then `INC $105F` + `$1015 = $0001` (wake Kamek). **Else** (non-fort use): skip to state $04, seed full anim frame ($106D=6, $1063=6), and act like a tiny grounded Tap-Tap. |
| `$01` | `CODE_tap_tap_state_intro_kamek_talking` | intro | Frozen while Kamek delivers his quip. Reads `$1015` indirectly via the shell; once `$7A96` expires, sets Y-vel = `$FC00` (jump up), X-vel = `$0018`, zeroes `$1015`, anim frame $16, timer $0C. |
| `$02` | `CODE_tap_tap_state_intro_grow_and_rotate` | intro | Hops up, **grows + rotates around center**. While `$7A96 > $01`: shrink X-velocity by $06 each frame (gentle stop), accumulate angle in `$105D` by $08 per frame (full revolution). When `$7A96 == $01`: lock final frame, set OAM priority `$81`, advance. |
| `$03` | `CODE_tap_tap_state_intro_center_and_fall` | intro | Centers + falls. Waits for `$7860 & 1` (floor-hit flag), then: plays `$0047 Explosion`, sets `$61C6 = $18` (large screen shake), X-vel = `$40`, timer $A0, zeroes player cutscene state, INC `$105F`. |
| `$04` | `CODE_tap_tap_state_intro_pause_on_landing` | intro | Pauses on landing; when `$7A96 == 0` calls `CODE_0F9FFB` which sets `$105F = $05` (start AI) and seeds X-vel from `DATA_0F9F10`. |
| `$05` | `CODE_tap_tap_state_ai_walk_forward` | combat | The main pacing loop. Walks toward `$1064` target X via a 16-frame anim cycle in `DATA_0F9F00` (`$00..$0F` linear). Every cycle: plays `$0084 TapTapTheRedNoseWalk` + screen-shake `$0C`. Checks `$7860 & $0C` (wall) or `!$7860 & $1` (cliff or `$1074==0` mid-air) -> jump to state $07; checks `CODE_0FA5FE` (player-direction reversed?) -> state $06 (turn). |
| `$06` | `CODE_tap_tap_state_ai_turn_around` | combat | Plays a turn animation indexed off `$1060` (decrementing internal counter). After frame $08 of the turn, EOR `$7400,x` with $02 (flip facing). When counter reaches 0 -> state $05 (resume walk). |
| `$07` | `CODE_tap_tap_state_ai_prepare_jump` | combat | Jump windup. Uses `$16,x` as anim counter into `DATA_0FA027` (32 zero frames + 16 frames of $0F crouch + sentinel $FF). On sentinel: play `$0013 SpringBounce`, set X/Y velocity from `DATA_0FA01F` (per-facing-+-wall pair), INC state. |
| `$08` | `CODE_tap_tap_state_ai_airborne` | combat | Mid-jump. Maintains airborne anim via `DATA_0FA0A6`. On `$7860 & 1` (land): `$61C6 = $18` (shake), `$0047 Explosion` sound, state -> $09. |
| `$09` | `CODE_tap_tap_state_ai_landed` | combat | Post-jump recovery anim (`DATA_0FA105`). On sentinel: `CODE_0F9FFB` -> state $05 (resume walk). Includes a `JSR CODE_0F9FA2` (re-check player direction) before returning. |
| `$0A` | `CODE_tap_tap_state_damaged_knockback` | damage | Knocked back from egg hit. Anim frame `$12`. Sums `$1073 += $1072` (rotation-spin accumulator), waits for it to reach 0 with `$1060 == 0`, then -> state $0C. Special path: if `$1074` (floor-hit derived) AND `$7182,x < $A0` -> state $0D (hobble). |
| `$0B` | `CODE_tap_tap_state_damaged_egg_impact` | damage | Initial egg-hit impact. Uses `$16,x` indexed into `DATA_0FA18F` (anim frames $16->$15->$14->$12 then $12 hold, sentinel $FF). On sentinel -> state $0C. |
| `$0C` | `CODE_tap_tap_state_damaged_falling_air` | damage | Falling after airborne egg-hit. 84-byte anim table `DATA_0FA1D7` (frames $12/$13 mix, then $14/$15/$16 falling-tumble, then $00 still). On frame $30: kick Y-vel = $80 (small upward bounce), Y-accel = $FD. CPY $2C..$38: zero out X-velocity. On sentinel: `CODE_0F9FFB` (back to state $05 walk). |
| `$0D` | `CODE_tap_tap_state_damaged_hobble` | damage | Hobbling off-balance after egg hit. Walks-with-limp via anim table `DATA_0FA281` (alternating $17/$18/$19/$1A frames forming a tilted-stagger pattern, length 144). The `$1073/$1072` rotation accumulator drives a slight tilt offset added to anim selection. On sentinel: back to state $05. **This is the "wobble walk"** the player sees after an egg hit but before head-bop kill. |
| `$0E` | `CODE_tap_tap_state_death_sinking_lava` | death | Sinking in lava (head-bop kill entry). Anim frame `$12`, advance the `$1073` rotation accumulator (continued slow spin), when Y-pos >= `$D0`: `INC $105F` + `$7A96 = $60`. Per-frame: spawn one `$01C7` lava-splash AmbSpr + one `$01D9` AmbSpr from `CODE_tap_tap_per_frame_lava_anim` (4-frame palette ramp + bubble). |
| `$0F` | `CODE_tap_tap_state_death_rising_lava` | death | Rising in lava with mouth open/close convulsions. Per-frame lava anim continues. Anim frame alternates `$12`/`$13` based on `$0030 & $18`. Y-velocity oscillates between `$0080` and `$FF00` (rise/fall). Periodically plays `$0062 MelonBugBump` (the "guh" sound). On `$7A96 == 0` -> state $10. |
| `$10` | `CODE_tap_tap_state_death_submerging` | death | Submerging completely. Y-vel = $0040 (steady sink). Once `$7183,x < $08` (boss-Y above some threshold from above the floor): set state $11, `$7A96 = $20`, JSL `CODE_02A982` (set the boss-defeated WRAM flag), JSL `CODE_02E19C` (queue the closer-wall cinematic via the universal boss-closer at `$01:A248`). |
| `$11` | `CODE_tap_tap_state_death_explode` | death | Final explosion. Wait on `$7A96`, then `JSL CODE_despawn_sprite_free_slot` -- end of state machine. |

### 2.3 Two-phase shape

Like Hookbill, Tap-Tap is **two state machines glued together**:

- **Intro phase** (states `$00-$04`, 5 entries): pre-fight cinematic. The
  Kamek-talking entry at state $01 uses the engine's standard `$1015`
  handshake (see `docs/bossengine.md` §10 Q3). Tap-Tap is the **third**
  boss to use this exact handshake idiom (Hookbill state $58, Sluggy
  pre-enlarge, Tap-Tap state $00/$01).
- **Combat phase** (states `$05-$09`, 5 entries): walk-turn-jump loop. No
  ranged attacks -- Tap-Tap fights by closing distance via walk + jump
  arc only.
- **Damage phase** (states `$0A-$0D`, 4 entries): egg-hit reactions
  (knockback / impact / falling-while-airborne / wobble-walk). All return
  to combat (state $05) once their anim tables hit the sentinel.
- **Death phase** (states `$0E-$11`, 4 entries): lava-sinking
  cinematic. Distinctive in the boss roster -- see §4 below.

The dispatch byte `$105F` is **8-bit at a 16-bit slot**, distinguishing
Tap-Tap from Hookbill which uses `$76,x` (per-slot byte). Boss-closer
data also lives at `$1064` (target X), `$1063`/`$106D` (anim selectors),
`$1072`/`$1073` (rotation accumulators), `$105D`/`$105E` (SuperFX
angle/scale), and `$1060`/`$1061`/`$1069` (per-frame countdown timers).
All these are part of the boss WRAM block at `$0010xx`.

### 2.4 Egg-hit test (`CODE_tap_tap_egg_hit_test` at `$0F:A624`)

Distinct from Hookbill's egg-hit window-check pattern. Tap-Tap's tester
runs **every frame** from the shell and looks for any sprite slot
referenced in `$7D36,x` (the held-by link) whose `CurrentStatus == $10`
and `$7D38 != 0` (projectile-flag set). If found, the tester:

1. Reads the projectile's X-velocity sign and angle (`$AngleOfStoodOnGround`).
2. Selects an X-knockback from `DATA_0FA614` (8-word table indexed by
   sign + angle XOR + projectile-stop-flag).
3. Picks new state: state `$0B` (egg-impact) if projectile was moving,
   state `$0A` (knockback) if projectile had already stopped (`$00 == 0`).
4. Plays `$002E ClankSound7` and sets `$1069 = $20` (egg-cooldown timer
   blocking new hits for $20 frames).
5. Forwards the impact via `CODE_03B24B` (engine sprite-collision call)
   to also damage/despawn the egg.

The damage states `$0A` / `$0B` are entered here; states `$0C` / `$0D`
are entered as natural fall-throughs from `$0B` and `$0A` respectively.

The accepted head-bop path is entirely separate -- it's the
`$7862,x == $18` check in the dispatch shell (§2.1) that drives the
state-$0E death entry. So Tap-Tap is **one head-bop = death**; egg hits
just stagger him. Verified by reading `$1015` death-handshake: the death
path is gated by the shell, not by an HP counter.

### 2.5 Boss-room special transforms (in `CODE_0F9CA2`)

The "non-fort" branch in state $00 means the boss-code is also used as a
small enemy outside the boss fort. To support both, the shell does an
off-screen X clamp **only** in non-fort levels:

```
LDA !RAM_YI_Level_CurrentLevelFromMapLo
CMP #!Define_YI_LevelID_TapTapTheRedNosesFort
BEQ skip_clamp
REP #$20
LDA $7182,x
SEC : SBC $0030     ; Layer1YPos
CMP #$0120
BCC skip_clamp
BMI skip_clamp
LDA $0030 : SEC : SBC #$0040
STA $7182,x         ; clamp Y to top of screen + $40
LDA $0034 : CLC : ADC #$0180
STA $70E2,x         ; clamp X to right of screen + $180
skip_clamp:
```

This stops the boss-code-as-enemy from drifting off-screen during a
test/debug spawn. In the actual boss fort, the level mode pins the
camera anyway.

---

## 3. The smaller Tap-Tap variants (Bank0D)

The three regulars (`$109` Bronze, `$10A` Silver, `$10B` Hopping Silver)
share Init + Main at `$0D:C171` / `$0D:C1A5`. The state machine has
**6 entries**, dispatched via `JSR (tap_tap_ai_pointers,x)` at
`$0DC31A`.

### 3.1 Init (`init_tap_tap` at `$0D:C171`)

```
init_tap_tap:
    LDA $6FA2,x : STA $701900,x      ; cache OAM priority/dyntile-flags
    LDA $7400,x ; SpriteID byte (wait, it's read via EXRAM_NorSpr_SpriteID,x)
    LDA !EXRAM_NorSpr_SpriteID,x
    CMP #!Define_YI_NorSpr10B_HoppingSilverTapTap
    BNE not_hopping
    LDA #$000D : STA $7402,x         ; anim frame $0D (hop-prep pose)
    INC $7A36,x                       ; flag "hopping" submode (=1)
not_hopping:
    RTL
```

Only three pieces of init:

1. **Cache the SuperFX render flags** (`$6FA2,x`) into the per-slot EXRAM
   wildcard `$701900,x`. This snapshot is restored every frame by
   `main_tap_tap`'s post-dispatch line (`STA $6FA2,x` at `$0DC329`) --
   tap-tap variants don't get the normal palette-blink flag changes that
   most sprites do, so they freeze their render flags at spawn.
2. **For `$10B` only**: pre-arm anim frame `$0D` and `$7A36,x = 1`. The
   `$7A36,x` register is the "hopping mode flag" -- non-zero means "go
   into state $00's hop branch every walking cycle". Bronze and Silver
   leave `$7A36,x = 0`, so they walk-bob without hopping.
3. **Everything else** is engine-default (no X/Y velocity init, no anim
   timer setup, no per-slot wildcard preload).

### 3.2 Dispatch shell (`main_tap_tap` at `$0D:C1A5`)

```
LDY $7402,x : CPY #$0E              ; is anim frame = "rolling" (post-knockback collision)?
BNE check_tongued
  JSL CODE_03AA2E                   ;   SuperFX OAM disable for rolling-tilt
  REP #$10
  LDY $7362,x
  LDA #$8000 : STA $6008,y / $6010,y / $6018,y / $6020,y   ; disable 4 OAM entries
  SEP #$10

check_tongued:
LDA $7540,x : CMP #$0008             ; CurrentStatus == $08 means "this frame Yoshi tongued us"
BNE check_collision
  ; transition this slot from "being tongued" -> "tongued" sub-state
  LDA #$0010 : STA $7540,x          ; promote to status $10
  STZ $6168                          ; clear tongued-sprite-slot global
  LDA #$0005 : STA $74A2,x          ; OAM priority -> 5
  LDA $7042,x : AND #$FF3F : STA $7042,x   ; clear flip flags
  ; pick horizontal-tongue vs vertical-tongue path off $6150 (player mouth state)
  ...
  STY $76,x                          ; set state ($04 horizontal-tongued / $05 vertical-tongued)
  STA $7402,x                        ; set anim frame ($06 hor / $0A vert)
  STZ $7A98,x
  PLA / PLY / RTL                    ; SHORTCUT: pop and exit early -- skip the main dispatch entirely

check_collision:
JSL CODE_03AF23                      ; engine sprite-housekeeping
LDY $7D36,x : BNE handle_coll        ; collision-link byte
JMP CODE_0DC315                      ; -> dispatch

handle_coll:
  DEY : BPL sprite_collision
  JSL player_hit_sprite              ; Yoshi-contact branch
  JMP CODE_0DC315
sprite_collision:
  LDA !EXRAM_NorSpr_CurrentStatus,y : CMP #$0010 : BNE no_coll
  LDA $7D38,y : BEQ no_coll          ; collided-sprite isn't a projectile -> skip
  STZ $701902,x                       ; clear "hit by egg" flag
  LDA #$0008 : STA $7540,x           ; flash to status $08
  LDA $7542,y : CMP #$0040
  BPL not_egg
    INC $701902,x                    ;   it WAS an egg -- set flag
    LDA #$FD00 : STA YSpeed,x        ;   bounce up
not_egg:
  ; ... select knockback X-velocity from DATA_tap_tap_collision_x_knockback (4 entries) ...
  ; ... play $002E ClankSound7 ...
  ; ... spawn $01EF impact AmbSpr at hitbox center ...
  STA $76,x                          ; -> state $02 (knockback)
  ;  also: if dyntile-index is set, JSL CODE_03AD24 and possibly set anim to $0E (rolling)
  ...

CODE_0DC315:
  TXY
  LDA $76,x : ASL : TAX
  JSR (DATA_tap_tap_ai_pointers,x)
  ; restore OAM priority/dyntile flags from cached $701900,x
  LDA $701900,x : LDY $76,x : CPY #$02 : BMI keep
    LDA #$0841                       ;   in damage states ($02+): override with priority $0841
  keep:
    STA $6FA2,x
  JSR CODE_0DC330                    ; SuperFX dyntile setup (or AEFD per-frame OAM)
  RTL
```

So the per-frame pipeline is: (1) maybe disable OAM for rolling, (2)
trap the "Yoshi tongued me" transition (early exit), (3) run engine
housekeeping, (4) handle player or projectile collisions (writing
`$76,x` to the new state), (5) dispatch the state handler, (6) refresh
SuperFX render flags from the per-slot cache.

### 3.3 The 6-entry state machine (`DATA_tap_tap_ai_pointers` at `$0D:C189`)

| `$76,x` | Handler | Behaviour |
|---------|---------|-----------|
| `$00` | `CODE_0DC389` | **Walking with periodic bob OR hopping.** If `$7A36,x != 0` (`$10B` hop-mode): every floor-touch, decrement `$18,x`; on underflow, set `$18,x = 5`, Y-vel = `$FC00` (hop), anim frame `$10` (jumping pose); otherwise read from `DATA_0DC37F` (5-entry hold-time table) and `DATA_0DC384` (5-entry frame table $0F/$11/$0F/$11/$0F flicker). If `$7A36,x == 0` (Bronze/Silver): walk-bob -- increment anim frame, every 4th frame play `$0026 WalkingTapTap` sound and seed X-velocity from `DATA_0DC37B` (per-facing), advance to state $01. |
| `$01` | `CODE_0DC3EE` | **Walking (post-bob).** Timer-based forward walk for 12 frames (`$7A98 = 2`, INC anim, when frame >= $0A: reset, return to state $00 with new bob cycle). On entry-to-Hopping subbranch: if `$7A36 != 0`, set anim frame `$0D` (hop-prep). |
| `$02` | `CODE_0DC41E` | **Knockback (post-collision).** Friction-decay X-velocity by `$0020` per frame. While knockback still active, accumulate rotation in `$7A38,x` from speed * sign-of-(facing-XOR-direction). When velocity decays to within $0040: stop, zero X-accel, if was-rolling (anim $0E) call `CODE_03AEFD` (dyntile-stop), reset anim to `$000A`, set `$7A98 = $60` (recovery cooldown), `$16,x = 6` (blink counter), -> state $03. |
| `$03` | `CODE_0DC496` | **Recovering (blink-and-wait).** Counts down `$16,x` while alternating anim frames from `DATA_0DC48A` ($0D/$0C/$0A/$0B/$0A/$0B) and hold times from `DATA_0DC490` ($12/$02/$10/$04/$08/$04). When `$16,x == 0`: reset anim to $00 (or $0D if hopping mode), -> state $00. |
| `$04` | `CODE_0DC4CE` | **Horizontally tongued.** Wait for X-velocity to decay to 0 (engine pulls the slot toward Yoshi's mouth). Then $10-frame wait via `$7A96`, reset anim to $00 (or $0D if hopping), -> state $00. The slot stays "in Yoshi's mouth" via `$7540,x = $10` set during transition; the engine handles the actual eat/spit. |
| `$05` | `CODE_0DC505` | **Vertically tongued.** Wait for `$7860,x` (collision flags) to drop to 0, then fall through to state $04's behaviour. The vertical-tongue case lets gravity work on the slot until it's lifted clear of any floor. |

### 3.4 Three knockback / tongue-speed tables

These are the helpers `docs/bossengine.md` §7.2 names but doesn't
locate -- they're in **Bank0D**, not Bank0F, despite the boss-engine doc
suggesting otherwise:

```asm
DATA_tap_tap_collision_x_knockback:    ; $0D:C195
    dw $FE88, $0178, $FE00, $0200      ; 4 entries -- knockback X-velocity by (sign-of-projectile-X << 1 | hit-by-egg)
                                       ;   [0] = $FE88: gentle leftward (not-egg, hit from right)
                                       ;   [1] = $0178: gentle rightward (not-egg, hit from left)
                                       ;   [2] = $FE00: stronger leftward (egg, hit from right)
                                       ;   [3] = $0200: stronger rightward (egg, hit from left)

DATA_tap_tap_tongue_x_knockback:        ; $0D:C19D
    dw $0180, $FE80                    ; 2 entries -- horizontal tongue pull X-velocity
                                       ;   [0] = $0180: pull right (Yoshi to right of tap-tap)
                                       ;   [1] = $FE80: pull left (Yoshi to left)

DATA_0DC1A1:                            ; $0D:C1A1
    dw $FF80, $0080                    ; 2 entries -- ambient-sprite ($01E0) X-velocity for tongue impact puff
```

These tables don't apply to the Red Nose -- the boss uses its own
`DATA_0FA614` (8-entry, indexed differently) and `CODE_0FA5FE` for
direction tests.

### 3.5 Yoshi-direction check (the Bank0D variant)

Where the boss has `CODE_tap_tap_check_yoshi_dir` (`$0F:A5FE`, returns Y=0
or Y=2 from sign-of-X-distance), the regulars don't need an explicit
helper -- the engine sets `$77C2,x` and `$77C3,x` to "Yoshi-X-direction"
and "Yoshi-Y-direction" respectively, and `main_tap_tap`'s tongue path
reads them directly:

```
LDY $77C3,x                   ; Yoshi above (1) or at/below (0)?
BEQ horizontally_tongued      ;   if not above, force horizontal tongue path
  LDA #$FD00 : STA YSpeed,x   ; otherwise: vertically tongued, Y-vel = -3px/frame
  LDY #$05 : LDA #$000A       ;            new state = $05, anim frame = $0A
  BRA ret_tongued
horizontally_tongued:
  LDY $77C2,x                 ; Yoshi left (0) or right (2) of sprite?
  TYA : STA $7400,x           ; mirror to facing
  ...                          ; pick X-vel from DATA_tap_tap_tongue_x_knockback,y
  LDY #$04 : LDA #$0006       ; new state = $04, anim frame = $06
ret_tongued:
  STY $76,x : STA $7402,x
```

The engine sets `$77C2,x` / `$77C3,x` each frame, so this is constant-time.

### 3.6 Per-variant differences

The three IDs share the *same code* (Init + Main + all 6 state handlers
+ both knockback tables); the only behavioral divergence is encoded in
**two bits**: 

1. **`$10B` Hopping flag** -- set at Init by `INC $7A36,x` (becomes $1).
   The state-$00 handler branches on `$7A36,x`: zero = walk-and-bob,
   non-zero = walk-and-periodic-hop. State $01 and state $03 use the
   same flag to decide whether to set anim frame $0D (hop-prep) vs $00
   (idle) when returning to state $00.

2. **Sprite-ID compare for the hopping path** in state $04 (`CODE_0DC4CE`)
   at line 8852: when leaving the horizontally-tongued state, the
   handler checks `LDA !EXRAM_NorSpr_SpriteID,x : CMP #!Define_YI_NorSpr10B`
   to choose anim frame `$000D` (hop-resume) vs `$0000` (walk-resume).

What's **NOT** encoded in code:

- **Palette** (Bronze vs Silver) is read from the per-sprite tile
  template at level-load by the SuperFX dyntile loader. The bronze/silver
  divergence is purely a graphics/palette swap at tile-allocation time;
  the runtime code is byte-identical for `$109` and `$10A`.
- **Ledge-staying behavior** that the in-source comment at
  `Bank0D.asm:8390` mentions ("walks, then stays on ledges, then
  hopping") -- after re-reading the state machine, I can't find a
  distinct "stay on ledge" code path for `$10A`. The constants-file
  annotation calls Silver "stomp-immune; defeated by Yoshi-launched
  eggs"; in code, all three variants are stomp-immune (no `$7862 == $18`
  head-bop path in `main_tap_tap`, only the projectile-collision path in
  `CODE_03B25B`/`$76 = $02`). The "ledge-staying" difference appears to
  be entirely an emergent property of where in the level the variant
  spawns, not a code-level distinction. This contradicts the
  NormalSpriteIDs.asm one-line summary; left as a doc-tightening
  candidate.

So the practical answer to "what does the variant ID select?" is:
**palette + hop-mode (`$10B` only)**. `$109` and `$10A` differ only in
which tile/palette template is loaded, not in any code path.

---

## 4. Death-by-water (lava) sequence

This is the most distinctive cinematic in the Tap-Tap family: the boss's
4-state lava-sink animation (states `$0E-$11`).

### 4.1 Trigger

Single head-bop: `$7862,x == $18` (the engine sets `$7862` whenever Yoshi
ground-stomps onto a sprite slot). The dispatch shell (§2.1) catches
this *after* state-dispatch each frame, sets `$105F = $0E`, kicks off
the lava-splash spawn (§4.2), silences music, and clears the boss's
SuperFX render bits.

### 4.2 Lava-splash spawn (`CODE_tap_tap_spawn_lava_splash`)

On the kill frame, 30 ambient sprites of ID `$01C7` are spawned via 16
indexed parameter offsets in `DATA_0FA44A`/`DATA_0FA46A`/`DATA_0FA48A`/
`DATA_0FA4AA`. Per slot:

- X-offset from boss: `DATA_0FA44A` (16-word fan: $FFF0..$0012, with
  alternating bias on even vs odd indices for staggered horizontal
  splash).
- Y-position: at the boss's Y (`$7142,y = $07C0`, the lava-surface line
  in this room).
- X-velocity: `DATA_0FA46A` ($FF00..$00E0 spread).
- Y-velocity: `DATA_0FA48A` ($FE08..$FE60 upward, varying).
- Lifetime: `DATA_0FA4AA` (16 entries, all `$0030`).
- AmbSpr-specific `$7502,y = $0020` (per-AmbSpr behaviour byte).

The 30 sprites form a fan-shaped splash visible for ~48 frames.

### 4.3 The 4 death states (`$0E`-`$11`)

```
$0E sinking
  - anim frame $12 (death-stiff pose)
  - "$1073 += $1072" each frame (slow rotation accumulator continues -- 
    he keeps spinning while sinking)
  - Y-velocity = DATA_0FA377[$0030&2] + $0040 ($0080 or $FF80 + $0040, 
    so a slow descent with sub-period oscillation)
  - X-velocity zeroed
  - When $7182,x >= $D0 (down past the surface): -> $0F, $7A96 = $60
  - Plus: every 4 frames, call CODE_tap_tap_per_frame_lava_anim
    which spawns 1 x $01C7 lava-splash + 1 x $01D9 bubble at the boss's
    X, Y velocity from DATA_0FA37B (4-entry vertical-splash table), 
    lifetime $0030.

$0F rising
  - "Mouth open/close convulsions": anim frame = $12 OR $13 (toggle based on $0030 & $18)
  - Per-frame lava anim continues (more bubbles, more splash)
  - Y-velocity oscillates between $0080 (rise) and $FF00 (fall) (DATA_0FA511)
  - Sound: $0062 MelonBugBump every $20 frames (the "guh" gargle)
  - On $7A96 == 0: -> $10

$10 submerging
  - Per-frame lava anim continues
  - Y-vel = $0040 (steady sink)
  - Plus: every 4 frames, $1073 += $FF or $01 (drift)
  - When $7183,x < $08 (Y high byte goes negative -- boss is now far 
    above the spawn point, i.e., far below the lava surface): 
      - JSL CODE_02A982 (set "boss defeated" WRAM flag, advances world map)
      - JSL CODE_02E19C (queue the universal closer-wall cinematic at $01:A248)
      - $105F = $11, $7A96 = $20

$11 explode (final wait)
  - Wait on $7A96
  - When 0: JSL CODE_despawn_sprite_free_slot 
  - End of state machine. Slot is now reclaimed by the engine.
```

The lava-splash + bubble loop in `CODE_tap_tap_per_frame_lava_anim`
(`$0F:A3D6`) is the per-frame engine that gives the death its
distinctive bubbling-lava aesthetic. It runs in states `$0F` and `$10`
on every 4th frame (`$0030 & $3 == 0`), so the lava surface keeps
bubbling for the ~$80-frame submerging cinematic.

### 4.4 Why "lava" not "water"

The boss room (TapTapTheRedNosesFort, level `$3F`) has its bottom plane
as a lava bowl -- but the death code spawns `$01C7` (lava splash) +
`$01D9` (auto-scroll setter / bubble), not water-splash ambient sprites.
There's no `$0062` *splash* sound; the only audio cue is `MelonBugBump`
on the convulsion frames (a "guh" gargle), plus the boss's "$007A
HurtNepEnut" on the kill frame (the boss's hurt cry). Note: `HurtNepEnut`
references the *boss's name in a different language* -- "Nep Enut"
(palindrome of Ten Pin, with letters reversed) was the Tap-Tap-equivalent
name in some European releases -- which is why the sound ID retains it.

The submerge timer is set on state-`$0F`-entry to `$60` ($96 frames =
~1.6s at 60Hz). The `$10` -> `$11` transition uses Y-pos < $08 (high
byte) -- so Tap-Tap is well below the screen-visible lava surface when
the closer-wall cinematic queues. This is why the player sees the boss
disappear into the lava with bubbles continuing to come up briefly
before the room transitions out.

---

## 5. Variant-encoding mechanism

A summary of how the four IDs split implementation:

### 5.1 The Red Nose (`$03C`) is entirely standalone

- Init/Main pair in Bank0F with no shared code paths to anything else.
- State byte at `$105F` (16-bit WRAM, boss-only). All other YI bosses
  use the standard per-slot `$76,x`; Tap-Tap is the only one with a
  WRAM-only state byte.
- 18-entry state table with intro/combat/damage/death sub-phases.
- Single-stomp kill via the engine's `$7862,x == $18` flag (no HP
  counter; no per-egg-hit count). Egg hits just stagger.

### 5.2 Bronze / Silver / Hopping Silver (`$109` / `$10A` / `$10B`)

A textbook **Pattern C** sharing structure (using the same vocabulary
as `docs/family-bandits.md` §5):

```asm
YI_NorSpr109_BronzeTapTap_Init:
YI_NorSpr10A_SilverTapTap_Init:
YI_NorSpr10B_HoppingSilverTapTap_Init:
init_tap_tap:
    ...

YI_NorSpr109_BronzeTapTap_Main:
YI_NorSpr10A_SilverTapTap_Main:
YI_NorSpr10B_HoppingSilverTapTap_Main:
main_tap_tap:
    ...
```

Three sprite-IDs collapse to two physical bodies (Init + Main) -- so
`YI_NorSpr109_BronzeTapTap_Init`, `YI_NorSpr10A_SilverTapTap_Init`, and
`YI_NorSpr10B_HoppingSilverTapTap_Init` are all just label-aliases for
the shared `init_tap_tap` body at `$0D:C171`; same for the three
`_Main` aliases for `main_tap_tap` at `$0D:C1A5`. **Any ambient-sprite
spawn site cited in the AmbSpr catalog as "inside `YI_NorSpr10B_..._Main`"
(e.g. `$01EF` collision-impact at `Bank0D:8581`) is really inside the
shared body** -- all three regular Tap-Taps reach it through the same
state-handler path. Variant divergence inside the bodies is encoded by:

- **Pattern A** (SpriteID-as-key-into-table): NOT used here. The variant
  selector is a single bit (`$7A36,x`) seeded at Init, not an indexed
  lookup.
- **Pattern B** (SpriteID-as-conditional-branch): used once, in state
  `$04` (`CODE_0DC4CE`) where the post-tongue resume animation differs.
  ```asm
  LDA !EXRAM_NorSpr_SpriteID,x
  CMP #!Define_YI_NorSpr10B_HoppingSilverTapTap
  BNE CODE_0DC502
    LDA #$000D : STA $7402,x          ; hop-resume anim
  ```
- **Stateful flag in `$7A36,x`**: seeded by Init for `$10B` only, read
  by states $00 / $01 / $03 to branch into the hop sub-mode. This is
  the simplest variant-encoding in the YI codebase -- a single byte
  marks the variant, and the state machine routes on it.

### 5.3 No cross-family code sharing

There is no code path that crosses between Bank0F's boss and Bank0D's
regulars. The boss's `CODE_tap_tap_egg_hit_test` is not callable from
the regulars; the regulars' `tap_tap_collision_x_knockback` table is
not read from the boss. The shared identity is purely at the level-data
+ sound + label-prefix layer.

---

## 6. Cross-references

- `docs/bossengine.md` §7.2 -- the boss-engine summary of the Red Nose
  (state-machine outline; states `$00-$11`).
- `docs/bossengine.md` §10 Q3 -- the Kamek-spell handshake protocol on
  `$1015` (used by Tap-Tap state `$00`/`$01`).
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher that
  ticks both the boss and the regulars (`spr_state_main`, `spr_state_on_head_bop`).
- `docs/family-bandits.md` §5 -- the Pattern A / B / C vocabulary for
  variant-encoding patterns; Tap-Tap regulars use Pattern C with a
  `$7A36,x` flag, no Pattern A.
- `docs/family-bowserfight.md` -- structurally similar "boss + supporting
  cast" reference for the Bowser-fight cluster (Bank0D's other half).
- `yi/Banks/Bank0F.asm` lines 3705-5188 -- Red Nose Init/Main + 18 state
  handlers + helpers (`CODE_tap_tap_egg_hit_test`, `CODE_tap_tap_spawn_lava_splash`,
  `CODE_tap_tap_per_frame_lava_anim`, `CODE_tap_tap_check_yoshi_dir`).
- `yi/Banks/Bank0D.asm` lines 8389-8852 -- Bronze/Silver/Hopping Init +
  Main + 6 state handlers + 3 knockback tables.
- `yi/Constants/NormalSpriteIDs.asm` -- the four `!Define_YI_NorSpr*`
  IDs ($03C, $109, $10A, $10B) with one-line summaries.
- `yi/Constants/SoundIDs.asm` -- `$0026 WalkingTapTap` (regulars),
  `$0084 TapTapTheRedNoseWalk` (boss), `$007A HurtNepEnut` (boss
  head-bop), `$0047 Explosion` (boss landings), `$0062 MelonBugBump`
  (boss death-rise convulsion), `$002E ClankSound7` (regulars egg-hit).
- `yi/Constants/LevelIDs.asm` -- `$3F TapTapTheRedNosesFort` (the boss
  fort; level 6-4).
- `yi/Constants/AmbientSpriteIDs.asm` -- `$01C7` (lava splash),
  `$01D9` (bubble), `$01E0` (tongue-puff for regulars), `$01EF`
  (collision-impact AmbSpr).
- `yoshisisland-disassembly/disassembly/bank0F.asm` -- Raidenthequick's
  28 descriptive labels for the boss: `init_tap_tap_the_red_nose`,
  `main_tap_tap_the_red_nose`, `tap_tap_state_ptr`, `tap_tap_init`,
  `tap_tap_intro_kamek`, `tap_tap_intro_growing`, `tap_tap_intro_falling`,
  `tap_tap_intro_wait`, `tap_tap_walking`, `tap_tap_turning`,
  `tap_tap_preparing_jump`, `tap_tap_jumping`, `tap_tap_landing`,
  `tap_tap_knocked_back`, `tap_tap_init_egg_hit`, `tap_tap_falling`,
  `tap_tap_falling_hobble`, `tap_tap_hobbling`, `tap_tap_death_sinking`,
  `tap_tap_death_rising`, `tap_tap_death_submerging`,
  `tap_tap_death_explode`, `tap_tap_check_yoshi_dir`.
- `yoshisisland-disassembly/disassembly/bank0D.asm` -- Raidenthequick's
  labels for the regulars: `init_tap_tap`, `main_tap_tap`,
  `tap_tap_ai_pointers`, `tap_tap_collision_x_knockback`,
  `tap_tap_tongue_x_knockback`.
- See also (parallel asm references): `ys_boss1.asm`, `ys_boss2.asm`,
  `ys_enmy.asm`, `ys_enmy3.asm` -- boss + per-enemy handler parallels.

---

## 7. Open questions

1. **Silver "stays on ledges" claim.** `NormalSpriteIDs.asm:296` claims
   `$10A` Silver Tap-Tap stays on ledges where `$109` Bronze falls off.
   Reading state $00 / $01 of `main_tap_tap` (the walking states), I see
   no code path that's gated on sprite-ID -- both variants follow the
   same anim cycle, X-velocity table, and floor-check (`$7860 & 1`).
   The ledge-safety behaviour might be:
   - An emergent property of where each variant spawns in levels (level
     data places Bronze near pits, Silver only on long platforms), or
   - A misreading of in-game behaviour (Silver does fall off ledges, the
     constants annotation is wrong), or
   - Encoded somewhere I missed (perhaps a hidden flag in `$7042`
     spawned from the dyntile template). Worth manually re-checking by
     spawning a `$10A` at the edge of a pit and observing behaviour. If
     the annotation is wrong, the SpriteIDs file gets a fix.

2. **The "Hopping" state-$00 hop trigger ($18,x underflow).** State $00
   for `$10B` uses `DEC $18,x : BPL` to time the hops. On underflow,
   sets `$18,x = 5` (the hop cadence). But `$18,x` is never initialised
   to a known value at Init (Init only seeds `$7402,x` and `$7A36,x`).
   The first hop's timing depends on the slot's previous `$18,x` value
   -- usually $00 from spawn-zero, which gives one immediate hop on
   spawn-frame. Verified by reading Init; could be tightened by adding
   `STZ $18,x` to Init for the hopping case. Doc-only finding; not a
   bug (current behaviour is consistent across spawns).

3. **`HurtNepEnut` sound ID name.** SoundID $7A is named
   `HurtNepEnut` in the constants file, referring to the
   "Nep Enut" name used in some European YI translations. The English
   YI does not use this name (it's "Tap-Tap"). Leaving the sound-ID
   name as-is per the constants-file precedent. Not worth a rename
   pass since the name is load-bearing for matching against
   `SoundIDs.asm`.

4. **`$1064` vs `$70E2,x`.** The boss writes target X to `$1064` in
   Init and reads it in state $05 (walking). Yet the boss also has its
   own X position at `$70E2,x`. The `$1064` "target" is consulted as a
   max-clamp on facing-flip in `CODE_0F9DBE`. Worth a closer look: is
   `$1064` always the room's right wall (`$0058`) or does it track the
   player? Quick reading suggests it's static after Init, but the
   walking state's clamp test on `$1064` should be verified.

5. **State-$0A vs state-$0D entry conditions.** The damaged-knockback
   ($0A) and damaged-hobble ($0D) states both run after an egg hit, but
   the differentiation is subtle: $0A's special branch checks
   `($7860 & 1) AND ($7182,x >= $A0) AND $1074`; on success it JMPs to
   `CODE_0FA279` which sets `$105F = $0D`. So $0D is reached *from* $0A
   when Tap-Tap is grounded after the knockback. But state $0B
   (egg-impact) also flows into $0D-via-$0C path. Mapping the exact
   condition tree (which egg-hit branches lead to wobble vs run-back)
   would clarify the player-facing behaviour ("egg hit while in air"
   vs "egg hit while on ground"). Worth a follow-up trace.
