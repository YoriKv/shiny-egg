# YI Carnivorous-plant family reference

Standalone reference for the Yoshi's Island carnivorous-plant sprite
family -- the rooted, mouth-opening hazards built around the
"chomp / inhale / spit / spore" archetype. Five in-scope sprites share
two physical state machines (a 17-state Piranha machine in Bank05 and
an 11-state Blow Hard machine in Bank0E); two more are projectile or
spore children. The three Naval-Piranha boss sprites ($171, $172,
$002) are part of the same visual family but live in a different code
neighborhood and are documented in detail by `docs/bossengine.md`;
they appear here as cross-references only.

This doc complements:

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_init`, `spr_state_main`, `spr_state_on_head_bop`,
  `spr_state_on_ride_yoshi`) that runs the per-variant Main bodies and
  routes every Yoshi-bop on a piranha-family sprite to the shared
  `CODE_head_bop_common` stub in Bank03.
- `docs/bossengine.md` -- §7.3 (GSU-dyntile boss family) for the Naval
  Piranha ($171) state machine, including the parent/bud/vine three-
  way slot link via $1072 / $1076 / $1078 / $108A, the 38-entry
  `DATA_naval_pir_state_ptr`, the 18-entry bud-dispatch table, and
  the 7-entry vine-depth lookup.
- `docs/family-clouds.md` -- briefly overlaps via the
  `YI_NorSpr0F9_YellowNeedlenose` ("needle ball") sprite. Blow Hard
  $0F8 spawns sprite $0F9 as its projectile (the same code that the
  needlenose family in Bank0E uses as its base init). The Ptooie
  Piranha $09F also fires a $0F9.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank05.asm` (the Piranha / Ptooie bodies, lines 4581-6086),
`yi/Banks/Bank0E.asm` (Blow Hard / Upside-down Blow Hard, lines
5466-6172), `yi/Banks/Bank0F.asm` (Nipper Plant / Spore, lines
1581-1839). Pointer tables (Init / Main / StompRt / RideYoshiRt) and
the shared `CODE_head_bop_common` body live in `yi/Banks/Bank03.asm`
(lines 2792-2947, 3181-3352, 3458-3545, 4303 for the body).
Cross-checked against Raidenthequick's `bank0[5EF].asm` descriptive
labels: `init_wild_piranha`, `main_wild_piranha`,
`init_wild_ptooie_piranha`, `main_wild_ptooie_piranha`,
`init_blow_hard`, `main_blow_hard`, `init_nipper_plant`,
`main_nipper_plant`, `init_nipper_spore`, `main_nipper_spore`.

---

## 1. Family at a glance

Seven sprites belong to (or are spawned by) the carnivorous-plant
family. Two more ($0F9, $00DD) are children that escape the family
strictly -- they're documented here only as spawn targets.

| Sprite ID | Constant name | Bank | Init handler | Main handler | StompRt | Role |
|-----------|---------------|------|--------------|--------------|---------|------|
| `$054` | `UpsideDownPiranhaPlant` | 05 | `$05:9F9F` `init_wild_piranha` | `$05:9FE6` `main_wild_piranha` | `head_bop_common` | Ceiling-mounted variant; shares 17-state machine with $066. Init only differs in a Y-anchor probe (`CODE_0EB8B7` floor-cell check) that nudges spawn-Y by +$08 if the cell above is solid. |
| `$066` | `PiranhaPlant` | 05 | `$05:9F9F` (shared) | `$05:9FE6` (shared) | `head_bop_common` | Ground-mounted base variant. The "Wild Piranha" of the manual. Idle -> emerge -> chomp -> grab-Yoshi -> chew -> eject -> retract -> defeated -> respawn. |
| `$09F` | `PtooiePiranhaPlant` | 05 | `$05:A87C` `init_wild_ptooie_piranha` | `$05:A8B3` `main_wild_ptooie_piranha` | `head_bop_common` | Stationary plant that lifts a tracking needle-ball (sprite $0F9) overhead and lobs it at Yoshi. 4-state main; uses SuperFX `FXCODE_0BBCF8` for line-of-sight aim. |
| `$0F8` | `BlowHard` | 0E | `$0E:AAC5` `init_blow_hard` | `$0E:AAF0` `main_blow_hard` | `head_bop_common` | Ground spike-plant. Inhales the player toward it then exhales (spawning ambient-puff sprites and a $0F9 needle-ball child). 11-state main; shares Init + Main + state-ptr table with $04C. |
| `$04C` | `UpsidedownBlowHard` | 0E | `$0E:AAC5` (shared) | `$0E:AAF0` (shared) | `head_bop_common` | Ceiling-mounted variant of $0F8. Init differs only via `DATA_0EAAC1[$7400]` (initial X-speed sign); Main flips `$6FA2` OAM-vflip on egg-hit (`$7D96 != 0`) to invert the death sprite. |
| `$164` | `NipperPlant` | 0F | `$0F:8B5B` `init_nipper_plant` | `$0F:8BA9` `main_nipper_plant` | `head_bop_common` | Rooted enemy that periodically blows out and re-roots. 4-state main (`DATA_0F8BB8`): idle / blow-out / mid-air-skid / turn. Hidden state $02 also spawns sprite $165. |
| `$165` | `NipperSpore` | 0F | `$0F:8B36` `init_nipper_spore` | `$0F:8B8D` `main_nipper_spore` | `head_bop_common` | Projectile fired by Nipper Plant. On floor-collide ($CurrentStatus == $0008 + alive bit clear) it morphs in-slot into a sprite $164 and re-runs the plant's Init -- "spore germinates". |

Out-of-scope (deep documentation lives in `docs/bossengine.md`):

| Sprite ID | Constant name | Bank | See |
|-----------|---------------|------|-----|
| `$171` | `NavalPiranha` | 02 | `docs/bossengine.md` §3, §7.3, Naval-piranha entries; 38-entry `DATA_naval_pir_state_ptr` at `Bank02.asm` |
| `$172` | `NavalPiranhaBuds` | 02 | `docs/bossengine.md` §7.3; 18-entry `DATA_naval_pir_bud_state_ptr` |
| `$002` | `NavalPiranhaVines` | 02 | `docs/bossengine.md` §7.3; 7-entry `DATA_naval_pir_vine_state_ptr` driven off boss-stalk-depth global `$7019D6,$1072` |

The base $066 Piranha and its $054 ceiling variant appear in green-
fortress and underground stages throughout the game. The Ptooie $09F
is most common in jungle / castle levels. Blow Hard ($0F8 / $04C)
appears in the snow-spike levels and a few castles. Nipper Plants
($164 / $165) appear in the World-6 jungle stages where they're the
primary ground hazard between Shy Guys. Naval Piranha is the W2
boss; the boss ($171) spawns its own child sprite $066 to act as the
chompable head graphic (see `Bank02.asm:11538` init; the spawn site
records the child slot in `$108A` for the intro "Yoshi eats the
plant" trigger).

All seven in-scope sprites share two engine-level traits:

- **StompRt is a fall-through into `CODE_head_bop_common`**
  (`Bank03.asm:4303`). None of the family stomp handlers do anything
  family-specific -- they all hit the giant alias block that drops
  into the common body. So a Yoshi-bop on a piranha plant runs
  `spr_state_main` once (to give the plant a render frame), then sets
  the OAM front-priority bits + $0040 to `$7542` (Yoshi-side
  ground-bonk fix). No die-state transition; piranhas survive a
  stomp.
- **RideYoshiRt is a bare RTL** (`Bank03.asm:3544-3545`). All
  carnivorous plants fall into the gigantic terminal `RTL` of the
  family-block right before `CODE_spr_state_init_entry` -- which means
  the engine's "Yoshi is standing on this sprite" hook never gets
  anything custom. Plants don't have ride physics.

Death routes vary per sprite (egg-hit, edge-fall, Ptooie-projectile-
absorption); see per-sprite sections.

---

## 2. The 17-state Wild Piranha machine ($054 / $066)

Both Piranha sprites are driven by a 17-entry sub-state pointer table
at `DATA_wild_piranha_state_ptr` (`$05:9FC0`, `Bank05.asm:4603`). The
current state index lives in `$76,x` (byte, word-aligned indices in
practice). The Main entry at `$05:9FE6` runs:

```
main_wild_piranha:
    LDA $18,x : ...     ; X-grab-offset (signed-extended to word in $0C)
    LDA $19,x : ...     ; Y-grab-offset (signed-extended; bit flip if $7042 negative -> $0E)
    LDA $7402,x : BEQ -> CODE_05A769  ; if anim frame 0, run SuperFX OAM stamper
    LDY $76,x : CPY #$04 ; states 3/4/5 = "Yoshi caught" branch
        ... freeze movement via STZ $611A
    LDA $7D96,x : BEQ ...  ; egg-hit flag set?
        ... if SpriteID == $054 (upside-down), flip OAM hflag $6FA2
    JSL CODE_03AF23                    ; standard gravity/anim refresh
    JSL CODE_03A2C7 : BCC ...          ; offscreen-cleanup test
        ; if states $02..$05 and offscreen, force despawn via CODE_03A31E
        ; also clears player state $0D94/$61D6 if grabbing
    ; if state >= $08 and held by sprite (7D36,x): force-detach via CODE_03B25B
    LDY $76,x : ASL : TAX
    JSR (DATA_wild_piranha_state_ptr,x)  ; dispatch
    ; output: stamp $0C/$0E adjustment into $7B56,x/$7B58,x for OAM tweak
```

The 17 entries:

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_05A11E` | **Idle.** Watch for Yoshi in a $E0 x $E0 box (after applying `+$70` recentering). Plays gulp setup, advances state if Yoshi-form is not SuperBabyMario and `CODE_03AD74` (carry-egg check) passes. |
| `$01` | `CODE_05A169` | **Emerge / open mouth.** Two paths: (a) already-grabbing (`$7D36,x` -> alive sprite linked with carry-flag set) -- runs `CODE_05A96C` (Ptooie's force-detach), shifts to state $0206; (b) per-frame jitter via `$7722,x` random + 4-frame mask, choose either a fresh ambush or wait. |
| `$02` | `CODE_05A36C` | **Chomp attempt.** Mid-air at peak X-offset. Calls `CODE_049B42` (player-bounding-box vs sprite test). On overlap: stamps player position into `$EXRAM_YI_Player_*Lo` (slot-relative), goes to state $05 with `$16,x = 4` (chew timer) AND if `$7E48` valid (boss-mouth-link), advances to "Yoshi grabbed" path via the `$0204` two-state jump; plays `!Define_YI_SoundID14_Gulp`. |
| `$03` | `CODE_05A456` | **Grab Yoshi onto stem.** Tracking pursuit -- the plant is locked to Yoshi's position so his hitbox follows the chomp head. Restores `$74A2,$7E48` (boss-mouth Y bias) if a boss-mouth was the cause. |
| `$04` | `CODE_05A5AF` | **Yoshi caught, chew animation.** Decrement `$701900,x` (chew-cycle counter); when it hits 0, transition to state $01 (chomp completed -- return for another); else return to state $05 with `$16,x = 20` (chew-timer reset). |
| `$05` | `CODE_05A402` | **Ejection / drop Yoshi.** Per-frame: OR `$7042` with `$0024` (eject-anim frame). When `$7A36,x >= $0100`, OR with `$0022` instead. Watches `$0035 & $CFF0` (Yoshi-shake input check) -- on input match, drops state byte `$16,x` by `$10` (faster eject) until it hits `$04`. |
| `$06` | `CODE_05A5DA` | **Retract head.** Tail-calls `CODE_05AAFC` (Ptooie's `$76,x = 2` handler -- "spit / drop ball") then `CODE_05A990` and the OAM stamper. (Shared with Ptooie state $2; see §3.) |
| `$07` | `CODE_05A5DF` | **Retract phase 2.** Tail-calls `CODE_05AB77` (Ptooie's defeated-fade-out body). |
| `$08` | `CODE_05A5F1` | **Defeated -- fall over.** Watches Yoshi X-pos against world-edge `$0300`; on past-edge, fades music (`MusicID_FadeMusicCommand`), spawns sprite `$00DD` (`CloseWallInNavalPiranhaRoom` -- the post-boss closer), sets Yoshi into state `$02 InCutscene`, and stamps generic-tables. Only reachable for the Naval-Piranha-child instance. |
| `$09` | `CODE_05A622` | **Defeat secondary.** Watches the boss-closer slot via `$105A`; on closer-complete, runs `CODE_03AD74` egg-carry, plays MusicID $0009 (boss-defeated jingle), spawns sprite `$0048` (key-from-boss), increments `$76,x`. |
| `$0A` | `CODE_05A65E` | **Defeat finish.** Watches the global boss-visited flag (`!RAM_YI_Level_BossHasBeenVisitedBeforeFlagLo`) and `$1015` for ready-to-exit, then arms a 4-frame anim cycle. |
| `$0B` | `CODE_05A6A6` | **Hit-stun.** Watches `$1015` BPL (cleared from below); when negative-cleared, arms timer `$7AF6 = $20` and ages `$7A96 = $FFFF`, advances. |
| `$0C` | `CODE_05A6BE` | **Hit-stun recover.** Watches the angle accumulator at `$7A38,x`; rolls it CCW $0002 per frame until it matches `$0030` (the "horizontal-aim" angle); then advances. |
| `$0D` | `CODE_05A6E8` | **Respawn / re-arm.** Watches `$7A38,x` rolling CW $0010 toward `$01D0`; on match, kicks Y-vel `$FC00`, sets OAM priority $8840, stamps current Y+$10 into `$78,x` (the new perch baseline), advances. |
| `$0E` | `CODE_05A719` | **Misc helper / settle.** Watches Y-pos vs the `$78,x` perch; on or below, restores OAM $8841 (back). Watches `$7682,x` (Y-vel-accum) for $0100; on match, arms `$7AF6 = $80` for a despawn-grace + advance. |
| `$0F` | `CODE_05A738` | **Misc helper 2 / cleanup.** On `$7AF6 == 0`, increments `$105A` (closer-slot accumulator) and `JML CODE_03A31E` to free the slot. On `$7AF6 == $30`, stamps `$61C6 = $0260` / `$61C8 = $01C0` (camera-pan to defeated-pose anchor). |
| `$10` | `CODE_05A758` | **Stub / end-of-table.** EOR `$7042` with `$0002` -- toggles a low animation bit; effectively a one-line "twitch" no-op that the main entry also intercepts at the top (`CPY #$10 / BEQ -> skip CODE_03AF23 gravity`). |

The state-machine has three distinct "phases" of life:

1. **Idle/ambush** (states $00..$02): waiting + lunge attempt + miss.
2. **Yoshi-caught** (states $03..$05): held + chew + spit out.
3. **Wind-down** (states $06..$0F): retract, defeated, hit-stun,
   respawn. States $08..$0A are only reachable for the Naval-Piranha
   child slot; the regular Wild Piranha doesn't enter the "fade + spawn
   closer wall" branch because its `$7E48` will never reference a boss.

### 2.1 Per-slot state held by a Piranha

Beyond the state byte at `$76,x`, the Piranha machine uses these slot
fields (all accessed via X unless noted):

| Address | Meaning |
|---------|---------|
| `$76,x` | Current sub-state (0..$10). Often written as a word from `LDA #$02NN / STA $76,x` -- the high byte is the next-state nibble + a flag (e.g. `$0204` = "advance to state $04 with $76 = $04 + $02 nibble"). |
| `$77,x` | Anim sub-frame (paired with $76 in word writes). Toggled to alternate chomp/munch animation. |
| `$78,x` | Perch-Y baseline (Y-position stash for state $0D respawn). |
| `$16,x` | Chew-cycle timer (decremented each frame in state $05; controls eject pace). |
| `$18,x`,`$19,x` | X/Y grab-offsets (signed bytes). Stamped from `$6020`/`$6022` global SuperFX OAM helper. Read every frame in main entry and sign-extended into DP `$0C` / `$0E` for use across handlers. |
| `$77C2,x` | Yoshi-facing reference (used to flip chomp direction in state $03/$04). |
| `$7400,x` | Plant-facing (0 = right, 2 = left). Driven by SuperFX line-of-sight result via `FXCODE_0BBCF8` in `CODE_05A2B8` (Ptooie's aim-update routine, shared by Piranha state $00/$0A/$0D). |
| `$7402,x` | Animation frame (passed to OAM builder). State $00 sets to 0 ("hidden"); state $01 sets to 1 ("emerging"). |
| `$7A36,x` | Mouth-open angle (rotates from $0100 to $0030 in state $0C/$0D). |
| `$7A38,x` | Body-rotation accumulator (0..$01FE; the AND $01FE keeps it angle-aligned). |
| `$7A96,x` | Generic per-slot countdown (chomp-pace timer). |
| `$7A98,x` | Long anim cooldown (hit-stun + chew timer in state $05). |
| `$7AF6,x` | Despawn-grace timer (states $0E/$0F). |
| `$7AF8,x` | Misc cooldown -- used during state $00 readiness check (Yoshi-in-reach gate). |
| `$7D36,x` | "Held-by" slot link -- the slot index (1-based; 0 = no link) of a sprite currently grabbing this Piranha. Drives state $01 force-detach + state $03 grab transitions. |
| `$7D96,x` | Egg-hit flag (raised by the engine's `CODE_03B22F` egg-overlap response). Non-zero triggers the upside-down OAM-vflip in main entry (line 4670). |
| `$7E48` | Boss-mouth link slot (level-global -- not per-slot). When the Wild Piranha is the chompable head of Naval Piranha, this points to the boss slot so state $02 can write `$74A2,$7E48 = $FF` (the "boss has been munched" flag). |
| `!EXRAM_YI_NorSprXXX_PiranhaPlant_GrabbedYoshiFlag` (= `701900,x`) | Chew-cycle counter; non-zero means "we have Yoshi", drives the state $04 main entry "freeze Yoshi position" path and the state $05 eject. |
| `!EXRAM_YI_Level_NorSpr_GenericTable701902,x` | Y-grab-anchor for the captured Yoshi (state $03/$04 reads this each frame to drag Yoshi's `$EXRAM_YI_Player_YPosLo`). |

### 2.2 Ceiling vs ground variant differentiation

The only init-time difference between $054 and $066:

```
init_wild_piranha:
    INC $7402,x                              ; bump to anim frame 1 (emerge)
    LDA $70E2,x : STA $REGISTER_SuperFX_R8
    LDA $7182,x : CLC : ADC #$0010
    JSL CODE_0EB8B7                          ; floor-cell probe
    BNE -> .skip
    LDA $70E2,x : CLC : ADC #$0008
    STA $70E2,x                              ; nudge X right by $08
.skip:
    RTL
```

`CODE_0EB8B7` is the engine's "is this tile coordinate solid?" test
(returns Z=1 on solid). Both sprites run the same code; only the
sprite-data X/Y placement differs (level data ID-tagged). The
ceiling-vs-ground difference is encoded entirely in the sprite-data Y
coordinate, and the `$7042` OAM bits (set by the engine before init)
are what flip the chomp-graphic vertically.

The runtime divergence is two CMP-branches at `Bank05.asm:4669` and
later in state $05 -- both inspect
`!EXRAM_YI_Level_NorSpr_SpriteID,x == $054` and apply a $6FA2-OAM
adjustment (flip the head graphic so the upside-down sprite chomps
upward).

---

## 3. The 4-state Ptooie Piranha machine ($09F)

The Ptooie variant is a standalone implementation. Its state-ptr
table at `DATA_ptooie_piranha_state_ptr` (`$05:A8AB`,
`Bank05.asm:5724`) has just 4 entries; the dispatcher at
`main_wild_ptooie_piranha` (`$05:A8B3`) runs:

```
main_wild_ptooie_piranha:
    LDY $18,x : ...    ; X-offset (sign-extended into $0C, $7B56,x)
    LDY $19,x : ...    ; Y-offset (sign-extended into $0E, $7B58,x)
    JSR CODE_05A769    ; if anim frame 0, run SuperFX OAM stamper (shared w/ Piranha)
    JSL CODE_03AF23    ; gravity/anim
    TXY : LDA $76,x : ASL : TAX
    JSR (DATA_ptooie_piranha_state_ptr,x)
    JSR CODE_05A94C    ; "held-by" force-detach handler (Ptooie-private)
    JSR CODE_05A990    ; angle/facing-from-$7A38 update
    JSR CODE_05A800    ; SuperFX OAM stamper (FXCODE_08D5F1)
    LDY $6022 : STY $18,x  ; stash X-offset for next-frame replay
    LDY $6020 : STY $19,x  ; stash Y-offset for next-frame replay
    RTL
```

The 4 states:

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_05A9CB` | **Idle pace + raise needle ball.** Walks `$7A36,x` toward `DATA_05A9C7` target ($0100 or $00E0 depending on `$16 & 1`). When `$16` underflows, samples `$70E2 & $0010` to bias state -- either continues with `$16 = 6` or arms a $10-frame charge cooldown and transitions to state $01. |
| `$01` | `CODE_05AA20` | **Charge / re-load.** Watches `$7A98` for "anim cooldown" expiry, clears `$77,x = 0` (sound-trigger gate). When `$16` is negative, arms a $10-frame anim cooldown, re-rolls `$16 = $0B` and resets to state $00. Else, picks a target angle from `DATA_05AA10[$7400+$16]` (16 entries), aims toward it via `CODE_05A916`, on aim-match: arms `$7A98 = $10` + `$7AF8 = $40`, spawns a sprite $00F9 child via `CODE_spawn_sprite_init`, copies positions into the child, kicks its X-velocity via SuperFX `FXCODE_0B8595` (the arc-velocity solver), advances to state $02. |
| `$02` | `CODE_05AAFC` | **Spit / drop ball.** If `$7AF8 == 0`, branches on SpriteID: if Ptooie ($09F), reads the "needle-ball-count" counter at `!EXRAM_YI_Level_NorSpr_GenericTable701900,x` (init = 3), copies `DATA_05AAF8[$701900-1]` (4-entry `$22,$22,$24,$20` table) into `$7042,x` (OAM anim-frame), decrements counter; if zero, plays SoundID $25 ("DyingPiranha") and advances state $76 to "defeated" ($03). Sub-branch via `$78,x` for parametric "ball drop" angle reset. Also called from Piranha state $06 -- but with the SpriteID check failing, it just plays the death-cue and advances. |
| `$03` | `CODE_05AB77` | **Defeated -- fade.** Decrements `$7A36,x` by $04 per frame; when below $30, sets `$74A0,x = $FF` (despawn marker) and tail-jumps `CODE_03B25B` (slot detach + free). Else, plays a 4-frame `$7042 EOR #$000E` flicker. |

Two interesting Ptooie-only mechanisms:

**Needle-ball counter.** `!EXRAM_YI_Level_NorSpr_GenericTable701900,x`
holds the number of remaining shots (init = 3 in `init_wild_ptooie_piranha`).
When the Ptooie is killed via state $02 -> $03, it plays a different
death sound (`DyingPiranha` vs the Piranha's gulp). Each successful
spit decrements this counter; on zero, the next spit attempt forces
state $03 -- so a Ptooie can survive a Yoshi-bop indefinitely but its
ammo runs out after 3 lobs.

**The SuperFX arc-velocity solver.** State $01's transition into "ball
launch" uses `FXCODE_0B8595` -- this is the GSU-2 routine that
computes the {X-velocity, Y-velocity} pair that will land a projectile
at a target XY given gravity and a specific arc apex. The Ptooie
passes in its own X/Y, the player's screen-XY (via the
`!EXRAM_YI_Level_NorSpr_GenericTable701902,x` field set by
`CODE_05A916`'s aim-bias), and a hard-coded apex multiplier of
`R6 = $FA00`. The same routine is used by Blow Hard for its spit
(see §4) and by Naval Piranha for bud-fire. The ball child sprite
inherits its X-velocity from `R0` and Y-velocity from `R1`.

---

## 4. The 11-state Blow Hard machine ($0F8 / $04C)

Blow Hard and its ceiling variant share a single Init + Main + 11-
entry state-ptr table. The table at `DATA_blow_hard_state_ptrs`
(`$0E:AADA`, `Bank0E.asm:5487`):

| `$76,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0EAD45` | **Dormant.** Waits on `$7A96` (animation cooldown); on expiry, runs `CODE_03AD74` (carry-egg check -- gate against Yoshi-not-ready), clears the X-anchor `!EXRAM_YI_Level_NorSpr_GenericTable701902,x`, increments anim frame `$7402,x` (start opening mouth), advances state. |
| `$01` | `CODE_0EAD5A` | **Open mouth / inhale spin-up.** Watches `$7A98` for spin-up timer. On screen-X check (`$7680,x - $18 < $00D0`, i.e. Yoshi visible within reach), sets `$77,x = 2` (palette/anim variant), `$7A36 = $00D0` (inhale strength), arms `$7A96 = $30`, advances state. Calls the SuperFX inhale-effect routine `CODE_0EB0E4`. |
| `$02` | `CODE_0EAD8F` | **Inhale -- hold + pull Yoshi.** Adds $04/frame to `$7A36,x` (suction strength); when at peak ($0100), arms a 4-frame `$7A96` cooldown and a 3-entry frame cycle from `DATA_0EAD8C` ($00, $04, $02 -- mouth opening progressively). On screen-X overflow (`$7680 + $10 >= $1020`, Yoshi out of reach), aborts back to state $00 with `$7A36 = $0100`, `$701900 = $FFFF` (sentinel "no inhale"). |
| `$03` | `CODE_0EAE14` | **Inhale -- pause before exhale.** Watches `$7A96 = 0`; clears `$77,x`, decrements `$701900` (sentinel update), advances. Calls `CODE_0EB14D` (the inhale-bubble ambient-puff spawner -- spawns `!Define_YI_AmbSpr1E2`). |
| `$04` | `CODE_0EAE31` | **Exhale -- spit projectile.** This is the family's signature attack. (a) Aim: ramps `$7A36` down by $10 to $00E0 (the spit angle), then uses `$78,x` (X-bias) sign-flipped through `FXCODE_0B8595` to compute arc velocities. (b) Spawn ambient-puff `!Define_YI_AmbSpr1E9` (`$1E9` is the breath-cloud effect). (c) Spawn sprite `$00F9` (`YellowNeedlenose`, the needle-ball projectile) via `CODE_spawn_sprite_init`. Stamps the FX `R0`/`R1` velocity outputs into the child's `XSpeed`/`YSpeed`. (d) Stamps `$16,x = 8` (sub-state pointer for state $05), tail-calls `CODE_0EB148` (cooldown puff), advances. |
| `$05` | `CODE_0EAEEF` | **Exhale-decay.** 4-entry sub-table `DATA_0EAEDF` keyed by `$16,x`. Adds $0A or $FFF4 (alternating) to `$7A36`, checks against `DATA_0EAEE7` thresholds ($0100, $00C0, $00F0, $00A0). When `$16` reaches 0, arms recovery (`$7A96 = $20`, `$7A98 = $0140`) and rewinds state $76 to $01. |
| `$06` | `CODE_0EAF36` | **Sleep -- wake on egg-hit / Yoshi-touch.** Animates `$7A36` between 2-entry table `DATA_0EAF2A`. On 6th cycle, advances state. Also: `CODE_0EABC0` (called from main entry pre-dispatch) checks `$61C6 != 0` (camera-bumped-by-egg flag) AND `$7D36,x` (egg-hit) -- if hit, force-resets the slot to `$76,x = 6` (sleep, but visible) with `$16,x = $0A`. So a hit during inhale or exhale rewinds the slot to sleep state. |
| `$07` | `CODE_0EAF70` | **Sleep-pace -- angle drift.** 2-entry `DATA_0EAF6C` ($0058 / $00A8) chooses target angle by `$7400,x`. Drifts `$78,x` by $04/frame from `DATA_0EAF68`. When at angle, animates the open-mouth tells via `$7A36`. |
| `$08` | `CODE_0EB032` | **Hit/damage taken.** Watches `$7A96 == 0` + `CODE_03AD74` (egg-carry); on both, increments anim frame, arms `$7A96 = $20`, clears `$701902`, sets `$16,x = 2` (sub-anim), advances. |
| `$09` | `CODE_0EB05A` | **Hit-stun fall-over.** 4-entry table `DATA_0EB052` (-$10, +$0A, +$0100, +$0120) keyed by `$16,x` adjusts `$7A36`. Different exit thresholds depending on `$16`; on threshold, arms `$7A96 = $40` and advances. |
| `$0A` | `CODE_0EB08C` | **Despawn-cycle / replay.** Watches `$7A96 == 0`; rewinds state to $01 to restart from open-mouth. Effectively a permanent-respawn loop (Blow Hard doesn't permanently die from a single egg-hit; he goes to sleep). |

### 4.1 Per-slot state held by a Blow Hard

Field overloading is heavier than the Bandit/Bumpty families because
Blow Hard reuses `$7A36` for three distinct semantic purposes across
states (suction strength, mouth-angle, decay accumulator). Beware
when reading state-handler code that the "current meaning of $7A36"
depends on `$76`'s phase.

| Address | Meaning |
|---------|---------|
| `$76,x` | Current sub-state (0..$0A). |
| `$77,x` | OAM/palette anim selector (0 or 2 -- chooses between `DATA_0EABFF[0]` and `DATA_0EABFF[2]` for the SuperFX render). |
| `$78,x` | Aim angle (0..$01FE). Used to spit the projectile in state $04 and to drift the sleep idle in state $07. Initial value comes from `DATA_0EAAC1[$7400]` (`$0040` for ground, `$01C0` for ceiling). |
| `$16,x` | Per-state sub-counter; e.g. state $02 frame index, state $04 sub-state-pointer ($08 = arming, decrements per frame). |
| `$18,x` | Mouth-cycle anim frame; bumped each frame in `CODE_0EACB4` while state >= $06. |
| `$7400,x` | Facing direction (0 = right, 2 = left). Set from `DATA_0EAAC1[$7400]` lookup at init; flipped during exhale aim recomputation in `CODE_0EAC07`. |
| `$7402,x` | OAM anim frame -- bumped by INC during state $00->$01 and state $08->$09 transitions (the visible "mouth opening" frame). |
| `$7A36,x` | Multi-purpose angle/strength accumulator. See state-table for per-state meaning. |
| `$7A38,x` | Body-rotation accumulator -- written by SuperFX into `$7A38` from `R0` in `CODE_0EAC07`. |
| `$7A96,x` | Generic short countdown. |
| `$7A98,x` | Generic long countdown (spin-up + recovery). |
| `$7D36,x` | "Held-by" slot link -- read in `CODE_0EABAC` and `CODE_0EABC0` to force a wakeup if held by a projectile slot (e.g. an in-flight egg). |
| `!EXRAM_YI_Level_NorSpr_GenericTable701900,x` | Inhale-sentinel ($FFFF = no inhale active, $00D0 = pulling). |
| `!EXRAM_YI_Level_NorSpr_GenericTable701902,x` | X-anchor for the player-pull math. Inhale-magnitude scaled by distance to this anchor in `CODE_0EACB4`. |

### 4.2 Upside-down differentiation

The init divergence is one indirect table:

```
init_blow_hard:
    LDY $7400,x           ; 0 (right) or 2 (left)
    LDA DATA_0EAAC1,y     ; -> $0040 or $01C0  (initial spit angle)
    STA $78,x
    LDA #$0100 : STA $7A36,x
    LDA #$FFFF : STA EXRAM_..GenericTable701900,x   ; inhale sentinel
    RTL
```

Both sprite-IDs run this. The only main-entry runtime divergence:

```
main_blow_hard:
    JSR CODE_0EAB30                  ; SuperFX OAM probe (R8/R9 corners)
    LDA $7D96,x : BEQ -> .skip       ; egg-hit?
    LDA EXRAM_..SpriteID,x : CMP #!Define_YI_NorSpr04C_UpsidedownBlowHard
    BNE -> .skip
    STZ $6FA2,x                      ; flip OAM priority for ceiling variant
.skip:
    ...
```

So $04C variants get their OAM `$6FA2` zeroed-out on egg-hit (so they
fall the right way visually -- the hit graphic is rendered upside-
down by the engine, the zero-priority makes it draw behind the spike
ceiling tile).

The projectile spawned by Blow Hard is `!Define_YI_NorSpr0F9_YellowNeedlenose`
(see `docs/family-clouds.md` for the needlenose family; the same
$0F9 init is shared by `init_needlenose_family` at `$0E:B1B2`). The
Ptooie and Blow Hard projectile is the same sprite -- they differ
only in their parent's spit-angle and `R6` apex multiplier.

---

## 5. The 4-state Nipper Plant machine ($164)

The Nipper Plant's main entry at `$0F:8BA9` (`Bank0F.asm:1652`):

```
main_nipper_plant:
    JSL CODE_03AF23                  ; gravity/anim
    LDA $16,x : TAX
    JSR (DATA_0F8BB8,x)              ; dispatch
    JSL CODE_03A5B7                  ; engine carry-item transfer check
    RTL
```

The 4 states (table `DATA_0F8BB8`):

| `$16,x` | Handler | Role |
|---------|---------|------|
| `$00` | `CODE_0F8BD0` | **Walk/skid mid-air.** Reads floor flag `$7860 & $0001`. If on ground, runs the air-anim cycle. Else samples X-velocity against $0020 / $0040 thresholds and writes anim frame `$7402,x` from a 5-entry lookup (`$00`, `$01`, `$02`, `$03`, `$04`). |
| `$02` | `CODE_0F8CC1` | **Idle (rooted).** Animates `$7402` between $05/$06/$07 on Y-velocity sign. When `$7860 & $0001` (on-ground), arms `$7A96 = 4`, clears anim sub-state `$18`. Else, decrements `$18`; when `$18 == 0`, picks `DATA_0F8CBD[$7400]` ($FF80 = left or $0080 = right) X-velocity + Y-vel $FE00 (jump up). |
| `$04` | `CODE_0F8C6D` | **Spit transition.** Watches `$7223,x` (egg-hit-block flag for blow-out). On positive, stashes X-pos in `$78,x`, sets Y-vel $F800 (faster blow), clears anim sub-state `$16`, falls through to `CODE_0F8BEB` (animate via skid table). Also pins Y-pos to `$609C - $10` (1 tile above floor) if `$7682,x` (Y-vel-accum) is fully negative. |
| `$06` | `CODE_0F8CA3` | **Turn / face Yoshi.** Watches `$7A96 = 0`; on expiry, reads `$77C2,x` (Yoshi-facing reference), stamps it into `$7400,x` (facing), arms `$16,x = 2` (return to idle). |

Note the **state-byte stride**: Nipper Plant uses `$16,x` as its state
byte (not `$76,x` like Piranha/Ptooie). The state-byte values are 0,
2, 4, 6 (word-stride into a `dw` table). State $00 is the air state
(mid-air after a blow-out); $02 is the rooted-idle; $04 is the just-
hit-by-egg launch transition; $06 is the post-land turn-toward-Yoshi.

The 16-byte timing table `DATA_0F8BC0` at `Bank0F.asm:1669` is a
short-lived anim helper -- not currently traceable from any
DATA_0F8BB8 path; it appears unused by the running state machine
(likely dead code or a hand-tuned table reserved for an early-game
nipper variant that was cut).

---

## 6. The Nipper Spore ($165) -- a self-germinating projectile

The Spore is a single-state sprite that morphs into a Nipper Plant on
floor contact. Init at `$0F:8B36` (`Bank0F.asm:1581`):

```
init_nipper_spore:
    STZ $7400,x                      ; reset facing
    LDA $70E2,x : STA $78,x          ; cache spawn-X
    PHA
    AND #$0010                       ; ground-tile-parity bit
    LSR : LSR : LSR                  ; -> 0 or 2 (TAY index)
    TAY
    LDA DATA_0F8B32,y                ; $0800 / $F800 -- Y-vel up/down
    STA $75E0,x                      ; gravity word
    PLA
    CLC : ADC DATA_0F8B2E,y          ; $FFF8 / $0008 -- X-pos kick
    STA $70E2,x
    LDA #$0004 : STA $7540,x         ; X-speed accumulator init
    RTL
```

The clever bit: the **same 2-entry table** (`DATA_0F8B32`) provides
both the spore's launch Y-velocity AND, later in `main_nipper_spore`,
the Plant's running anim speed. The parity bit of `$70E2 & $0010`
selects one of the two -- which means the Spore's spawn X position
encodes a {bounce-left + grow-left, bounce-right + grow-right} pair.
This is the only sprite in the family where a single 4-byte data
table serves two distinct semantic purposes (X velocity AND post-
germinate plant facing).

Main at `$0F:8B8D` (`Bank0F.asm:1637`):

```
main_nipper_spore:
    LDA EXRAM_..CurrentStatus,x : CMP #$0008  ; "alive, no contact"
    BNE -> CODE_main_nipper_plant             ; fall into plant main
    LDA $6FA2,x : AND #$8000 : BNE -> CODE_main_nipper_plant
    LDA #!Define_YI_NorSpr164_NipperPlant
    TXY
    JSL CODE_spawn_sprite                     ; morph slot's sprite-ID to $164
    JSL YI_NorSpr164_NipperPlant_Init         ; re-init as plant
    ; FALL THROUGH:
main_nipper_plant:
    ...
```

The slot is **re-typed in-place** -- `CODE_spawn_sprite` doesn't
allocate a new slot, it overwrites the current slot's sprite-ID
register. Then `init_nipper_plant` runs synchronously to re-seed the
slot's anim / state bytes. The next frame, dispatch will correctly
route to `main_nipper_plant` based on the new sprite-ID -- but
crucially, this frame also falls through and runs the plant main
once.

This is the only sprite in the family (and one of only a handful in
the engine) that uses **in-slot transmutation** -- compare to
`$0BC WingedCloudWithBandit` which despawns then re-spawns a different
sprite. The Spore avoids the despawn step entirely; the slot
identity is preserved across the morph.

---

## 7. Shared infrastructure

### 7.1 StompRt routing

All seven in-scope sprites (and Naval Piranha + buds + vines too)
share the same StompRt body via the Bank03 alias chain that
fall-throughs to `CODE_head_bop_common` at `$03:9F9F`
(`Bank03.asm:4303`):

```
CODE_head_bop_common:
    JSL CODE_spr_state_main                  ; one Main render-tick
    LDA $7040,x : AND #$FFF3 : ORA #$0004 : STA $7040,x  ; OAM tint
    LDA $7042,x : ORA #$0080 : AND #$00CF : ORA #$0020   ; OAM priority front
    LDY $7862,x : DEY : BPL .skip
    ORA #$0030                               ; ground-bump variant
.skip:
    STA $7042,x
    STZ $74A2,x
    LDA #$0040 : STA $7542,x                 ; Yoshi-side ground-bonk vel-kick
    LDA #$0400 : STA $75E2,x
    LDA $6FA0,x : AND #$F9FF : STA $6FA0,x
    LDA $6FA2,x : AND #$FFE0 : STA $6FA2,x
    RTL
```

The plants don't die from a stomp. The handler runs one Main frame
(so the sprite's Main has a chance to react to the bop -- e.g. the
Piranha's state-machine can re-enter chomp-recovery), then applies
the standard OAM-front-priority + ground-bonk recoil. Yoshi gets a
$0400 vertical kick from `$75E2`. No death-pop, no state-change.

This is the same body shared by Bumpty (cannot stomp), Big Boo
(cannot stomp), Toady family (cannot stomp), Stretch and most
egg/coin-bandit-helper sprites. The piranha family fits the "spiky,
not stompable, side-of-the-head is a hitbox" enemy archetype.

### 7.2 RideYoshiRt routing

All seven sprites (and Naval Piranha + buds + vines) share the
gigantic terminal `RTL` alias-chain at `Bank03.asm:3544-3545`. The
"Yoshi rides this sprite" hook is a bare no-op for the whole family.
No plant in the game has a ride-on hitbox.

### 7.3 The shared SuperFX OAM stamper `CODE_05A769`

Both the Piranha and Ptooie Main entries call `CODE_05A769`
(`Bank05.asm:5570`) once per frame when `$7402 == 0` ("hidden" anim
frame). This is the shared OAM-frame setup that writes the 4 sprite
sub-tiles into the OAM build buffer with positions offset by
`$7400,x` (facing) and a 3-entry magnitude table `DATA_05A763`. The
state $06+ death/grab transitions skip this (don't emit hidden-anim
OAM bytes).

### 7.4 The shared aim-update `CODE_05A2B8`

The Wild Piranha's "where is Yoshi relative to me" angle update at
`CODE_05A2B8` (`Bank05.asm:4980`) uses SuperFX `FXCODE_0BBCF8` (the
inverse-tangent / aim-vector routine -- common to many enemies) and
writes the result into `$7A38,x`. The Ptooie reuses this code path
indirectly through its state $00 -> $01 transition (sharing the
`DATA_05AA10` 16-entry angle table). Naval Piranha buds use the
same FX routine.

### 7.5 Per-family projectile spawners

| Parent sprite | Projectile sprite | Spawner | Velocity routine |
|---------------|-------------------|---------|------------------|
| `$09F` Ptooie | `$0F9` YellowNeedlenose | `CODE_spawn_sprite_init` in state $01 (`CODE_05AA20`, line 5956) | `FXCODE_0B8595` with `R6 = $FA00` (high arc) |
| `$0F8` / `$04C` Blow Hard | `$0F9` YellowNeedlenose | `CODE_spawn_sprite_init` in state $04 (`CODE_0EAE31`, line 5974) | `FXCODE_0B8595` with `R6 = $FC00` (flatter arc) |
| `$164` Nipper Plant | `$165` NipperSpore | `CODE_spawn_sprite_init` at end of state $02 (not directly visible -- the spore is spawned by the Plant's blow-out state via the engine's regular spawn path); also see Bank0F:1645 for the in-slot morph back |
| `$0F8` / `$04C` Blow Hard | `!Define_YI_AmbSpr1E9` (breath-cloud) | `CODE_spawn_ambient_sprite` in state $04 line 5949 | -- |
| `$0F8` / `$04C` Blow Hard | `!Define_YI_AmbSpr1E2` (inhale-bubble) | `CODE_spawn_ambient_sprite` in `CODE_0EB14D` line 6360 | -- |
| `$0F8` / `$04C` Blow Hard | `!Define_YI_AmbSpr209` (exhale puff) | `CODE_spawn_ambient_sprite` in state $07 line 6141 | -- |
| `$066` (as Naval child) | `$00DD` CloseWallInNavalPiranhaRoom | `CODE_spawn_sprite_active` in state $08 line 5392 | -- |

The needle-ball convention (Ptooie + Blow Hard both fire `$0F9`) is
the family's "shared ammo type". The visual difference between the
two firing animations is entirely in the parent's
spit-frame OAM (Ptooie has a tracking-aim chest-frame; Blow Hard has
a puff-cheek frame). The projectile itself is identical.

### 7.6 The SuperFX renderers used

| FXCODE | Used by | Purpose |
|--------|---------|---------|
| `FXCODE_08D5F1` | Piranha + Ptooie OAM stamper (`CODE_05A800`) | Full SuperFX-driven OAM tile blit with rotation; reads from `DATA_03A9CE` / `DATA_03A9EE` (the standard sprite anim ROM pointers) and stamps via `R12`/`R13` loop. |
| `FXCODE_08D883` / `FXCODE_08D8F0` | Chain-Chomp chain-segment render variants (NOT used here) | Both chain-Chomp $082 chain-segment helpers selected by alive-flag `$0E13`; 08D883 = smooth 2D DIV2 interpolation when alive, 08D8F0 = clamp-X-to-body-±R10 when just-hit (recoil animation). See block comment at `yi/Banks/Bank05.asm:CODE_chain_chomp_update_chain` for full asm-trace breakdown. |
| `FXCODE_098F33` | Piranha overlap test (`CODE_05A0C3`) | Bounding-box intersection of Piranha bite-box vs every alive normal-sprite slot. Used by state $01 to detect "another sprite (e.g. egg) just hit me". |
| `FXCODE_0884A5` | Blow Hard renderer (`CODE_0EAC61`) | Full SuperFX rotate-and-stamp for Blow Hard's body. |
| `FXCODE_0B86FA` | Blow Hard inhale-effect (`CODE_0EACB4`) | Per-frame visualizer for the inhale-suction lines + Yoshi-pull math (the "wind streaks" visible during inhale). |
| `FXCODE_0BBCF8` | Piranha aim-update + Blow Hard inhale-aim | Inverse-tangent (player-relative aim angle). Returns angle in `R0`. |
| `FXCODE_0B8595` | Ptooie + Blow Hard arc-velocity solver | Computes `{R0, R1}` = `{X-vel, Y-vel}` for a projectile launched at the player. Apex multiplier in `R6`. |

---

## 8. Slot-link conventions (the family's contract)

A few non-obvious slot-link patterns surface across the family:

**Plants don't track each other.** Unlike the Bandit family (where
the Red Coin Bandit and its Coin form a two-way `$18,x <-> $701900,y`
slot link), no two Piranha-family sprites have direct slot links.
The Naval Piranha boss links its child `$066` via the level-global
`$108A` (boss-link); the buds via `$1076`/`$1078`; the vines via
`$701978`. But two regular Wild Piranhas (or two Ptooies) in the
same level never link.

**The "held-by" link `$7D36,x` is read but not written by the family.**
All piranha-family Main entries READ `$7D36,x` to detect "is something
gripping me right now" (a tongue-eat, a stomp-pin, an egg-stick), but
none of them WRITE to it -- that's reserved for the engine's tongue
handler (Bank06) and the egg-stick handler (Bank0A). When `$7D36`
references an alive sprite with `$7D38 != 0` (carry-active), the
piranha's Main reroutes to state-specific dispose logic:

- **Piranha state $0 / $1**: force-detach via `CODE_05A96C` (Ptooie's
  body), then jump to state `$0206` (transfer-skip).
- **Piranha state $08+**: similar force-detach, transition to state
  $10 (stub / end-of-table).
- **Blow Hard `CODE_0EABC0`**: rewind state to $06 (sleep), arm 10-frame
  recovery timer.
- **Nipper Plant**: no held-by handling. Nippers don't have grab
  logic -- if a tongue catches one, it just gets eaten via the engine
  default.

**The boss-mouth link `$7E48` is shared globally.** When the Wild
Piranha (sprite $066) is spawned as Naval Piranha's chompable head
(slot index recorded in `$108A` by `init_naval_piranha`), `$7E48` is
set to the boss's slot index. State $02's chomp-attempt then writes
to `$74A2,$7E48` (the boss-stomach byte) on a successful Yoshi-catch
-- which is how the Naval Piranha boss "knows" Yoshi has been eaten.
A regular level-spawned Wild Piranha sets `$7E48 = $FFFF` (no boss
link) at init via `init_naval_piranha`'s sibling logic, so this branch
is a no-op for non-boss Piranhas.

---

## 9. Cross-references for the Naval Piranha boss family

`$171` (NavalPiranha), `$172` (NavalPiranhaBuds), and `$002`
(NavalPiranhaVines) are documented in detail in
**`docs/bossengine.md`**. Pointers into that doc:

- **§3** -- W2 boss "Naval Piranha mother" alongside the other Bank01/02
  bosses; init pointer + HP at `Bank02.asm:11538`.
- **§7.3** -- "GSU-dyntile boss family" -- the three-sprite slot-link
  contract for Naval Piranha (mother / 2 buds / vine-pair-per-bud),
  the `$1072 / $1076 / $1078 / $108A` global registry, the 38-entry
  `DATA_naval_pir_state_ptr`, and the bud/vine main dispatchers.
- **§10 Q6** -- open question: Naval Piranha phase-RNG seed ordering
  at `$1086`.
- **§10 Q7** -- open question: bud sub-state `$0E` world-space anchoring
  math.

The Naval Piranha boss spawns a **regular Wild Piranha** ($066) as its
chompable head graphic at init time (`Bank02.asm:11538`, the
`JSL CODE_spawn_sprite_active` of `$0066`). That child runs the 17-
state Wild Piranha machine from §2 here, NOT the boss's 38-state
machine -- the head is its own slot. But the child's `$7E48` is wired
back to the boss slot (`$1072 = boss X`), and the head's state-$08
defeat path is the *only* code path that spawns sprite `$00DD`
(the `CloseWallInNavalPiranhaRoom` closer cinematic) -- the W2 boss
defeat trigger is fired by the *head*, not the boss itself.

Naval Piranha's own state-machine drives the body-extension /
stalk-rise / lateral-sway. The "mouth that hits you" is the spawned
child. Two distinct sub-engines in one boss room.

---

## 10. Open questions / unclarities

- **Piranha state $10 (stub).** The `EOR $7042 with $0002` toggle has
  no obvious gameplay role. It's reached only via the state-$08+
  held-by-detach path (`CODE_05A07B` writes `$76 = $10`). Could be a
  defensive "render the slot for one more frame, swap palette to
  freed-color" cleanup. Verify with runtime trace: enter state $10
  from state $0A, watch for OAM tint flip.
- **Ptooie needle-ball ammo persistence.** The
  `!EXRAM_YI_Level_NorSpr_GenericTable701900` counter starts at 3
  but is decremented only on successful spits in state $02. If the
  Ptooie is bopped during state $01 (charging), the counter is not
  decremented -- so it effectively gets a re-roll. Possibly
  intentional ("you bopped me before I could fire, so I'll re-load").
  Verify by counting needle-balls fired across multiple stuns.
- **Nipper Plant's dead-code table `DATA_0F8BC0`.** 16 bytes that
  aren't referenced from any visible DATA_0F8BB8 path. Could be an
  earlier-revision anim table, a debug helper, or a SuperFX-side data
  blob accessed only from FX bank. The 16-byte structure
  ($01,$02,$03,$04,$03,$02,$01,$00,$08,$04,$08,$0C,$08,$04,$08,$0C)
  looks like a ping-pong anim cycle (frames 0-4 forward-back) followed
  by an alternation between $08/$04/$08/$0C. Not currently used by
  Bank0F's running state machine.
- **Spore in-slot morph -- preservation of `$7D36` / `$7D38` links.**
  When `main_nipper_spore` calls `JSL CODE_spawn_sprite` on the
  current slot, does the held-by link survive the morph? If an
  in-flight spore is tongued mid-air, what happens? Verify with
  runtime test: tongue an arcing Spore, watch for slot-corruption
  vs. successful eat.
- **Wild Piranha state-byte word-write convention.** Many transitions
  use `LDA #$02NN / STA $76,x` (word write of a state + high-byte
  flag pair). The high byte ($02 in `$0202`, `$0204`, $0206) seems
  to mean "anim sub-state 2 for the next state" -- but the bytes are
  packed into `$76 / $77`, and `$77` is also the OAM/palette anim
  selector. This dual-use is suspicious and may explain why some
  state transitions visually "wear" a slightly different anim frame.
  Worth a cross-check against the SuperFX OAM stamper to see how
  `$77,x` is consumed.

---

## 11. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` -- canonical sprite IDs and one-
  line summaries for `$054`, `$066`, `$09F`, `$0F8`, `$04C`, `$164`,
  `$165`, plus the Naval Piranha boss trio `$171`, `$172`, `$002`.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  (`spr_state_main`, `spr_state_on_head_bop`, etc.) that runs every
  piranha-family Main + the shared `CODE_head_bop_common` stub.
- `docs/bossengine.md` -- §3 (boss roster), §7.3 (Naval Piranha GSU-
  dyntile family), §10 Q6/Q7 (Naval Piranha open questions).
- `docs/family-clouds.md` -- the `$0F9` YellowNeedlenose projectile
  family; the Ptooie and Blow Hard both spawn $0F9 children.
- `docs/leveldataengine.md` -- how sprite-list entries spawn piranha
  slots in regular levels; Naval Piranha is spawned as a boss-room
  entry per `docs/bossengine.md §3.5`.
- `yi/Banks/Bank03.asm` -- StompRt + RideYoshiRt pointer tables
  (lines 1053-1334, 1450-1644, 1504-1645) and the shared
  `CODE_head_bop_common` body (line 4303).
- `yi/Banks/Bank05.asm` -- Wild Piranha bodies and tables:
  `init_wild_piranha` (4581), `DATA_wild_piranha_state_ptr` (4603),
  `main_wild_piranha` (4625), per-state handlers `CODE_05A11E` ..
  `CODE_05A758` (4790-5560), shared OAM stamper `CODE_05A769`
  (5570-5689), Ptooie body `init_wild_ptooie_piranha` (5698),
  `DATA_ptooie_piranha_state_ptr` (5724), `main_wild_ptooie_piranha`
  (5730), per-state handlers `CODE_05A9CB`, `CODE_05AA20`,
  `CODE_05AAFC`, `CODE_05AB77` (5885-6112).
- `yi/Banks/Bank0E.asm` -- Blow Hard bodies and tables:
  `init_blow_hard` (5468), `DATA_blow_hard_state_ptrs` (5487-5499),
  `main_blow_hard` (5506), per-state handlers `CODE_0EAD45` ..
  `CODE_0EB08C` (5807-6227), shared helpers `CODE_0EAB30`
  (SuperFX OAM probe, 5539), `CODE_0EAB36` (corner-coords compute),
  `CODE_0EABAC` (`$7D36` egg-link force-detach), `CODE_0EABC0`
  (rewind-on-hit), `CODE_0EAC07` (aim update), `CODE_0EAC61`
  (renderer), `CODE_0EACB4` (inhale visualizer), `CODE_0EB0E4`
  (inhale-bubble spawn helper), `CODE_0EB148`/`CODE_0EB14D`
  (ambient-puff spawners).
- `yi/Banks/Bank0F.asm` -- Nipper Plant + Spore: `init_nipper_spore`
  (1581), `init_nipper_plant` (1609), `main_nipper_spore` (1636),
  `main_nipper_plant` (1652), `DATA_0F8BB8` (1662), per-state
  handlers `CODE_0F8BD0` (idle/air), `CODE_0F8CC1` (rooted/jump),
  `CODE_0F8C6D` (egg-hit), `CODE_0F8CA3` (turn).
- `yi/Banks/Bank02.asm` -- Naval Piranha boss bodies and tables
  (Bank02:11538 init, Bank02:11675 main, Bank02:12431 bud loop,
  Bank02:13809 bud init, Bank02:13839 bud table, Bank02:14596 vine
  init, Bank02:14647 vine main). See `docs/bossengine.md §7.3`.
- `yi/Memory/SRAM_SpriteSlots.asm` -- the EXRAM alias
  `!EXRAM_YI_NorSprXXX_PiranhaPlant_GrabbedYoshiFlag = !EXRAM_YI_Level_NorSpr_GenericTable701900`
  used by the Wild Piranha grab/chew mechanic.
- `yoshisisland-disassembly/disassembly/bank05.asm` -- Raidenthequick's
  descriptive labels for the Piranha + Ptooie bodies
  (`init_wild_piranha`, `main_wild_piranha`,
  `init_wild_ptooie_piranha`, `main_wild_ptooie_piranha`).
- `yoshisisland-disassembly/disassembly/bank0E.asm` -- Raidenthequick's
  descriptive labels for Blow Hard (`init_blow_hard`, `main_blow_hard`).
- `yoshisisland-disassembly/disassembly/bank0F.asm` -- Raidenthequick's
  descriptive labels for Nipper (`init_nipper_plant`,
  `main_nipper_plant`, `init_nipper_spore`, `main_nipper_spore`).
- `ys_pa.asm`, `ys_enmy.asm`, `ys_boss2.asm` -- parallel asm files for
  Piranha / Ptooie (Bank05), Blow Hard + Nipper (Bank0E/Bank0F shared
  enemy code), and Naval Piranha (boss2) respectively.
