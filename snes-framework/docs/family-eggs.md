# YI Egg family reference

Standalone reference for the Yoshi's Island Egg sprite family -- the
projectiles Yoshi lays and spits, the giant-egg variants used by
bosses, the bouncing egg-blocks scattered through levels, and the
sprite-side dispensers (egg plants, "full" spawners, decorative laid
eggs) that feed Yoshi's trail. Thirteen in-scope sprite IDs across
five banks, but only **one** physical egg-physics body
(`CODE_03B872` in `Bank03.asm`) drives the entire projectile cluster
-- the per-flavour differences are gates layered on top.

This doc complements:

- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  every entry here sits on top of (`spr_state_init`,
  `spr_state_main`, `spr_state_on_head_bop`, `spr_state_on_ride_yoshi`).
  All egg / egg-block / egg-source `StompRt`s collapse into the
  shared `head_bop_common` body in `Bank03.asm`; all `RideYoshiRt`s
  are bare RTLs. Eggs do not have ride physics; egg blocks rebound
  but don't carry Yoshi.
- `docs/bossengine.md` -- §3 (Prince Froggy / Frog Pirate bosses use
  the `$029` GiantEgg as the "wakeup" payload that re-spawns Baby
  Mario), §7.3 (Baby Bowser uses the `$026` BowserFightGiantEgg as
  ridden vehicle / projectile).
- `docs/family-misc.md` §2 (Watermelons) -- the watermelon family is
  the parallel projectile family with the same physics body shape
  (gravity + bounce + hit-scan + ambient-puff spawn). Eggs and
  watermelons share the same shared-StompRt alias block in
  `Bank03.asm` (the giant aliased label cluster at
  `head_bop_common`).
- `docs/family-clouds.md` -- the four "EggBlock" Winged-Cloud
  variants ($0BD `WingedCloudWithCoin` and the egg-themed clouds)
  are documented there. The Egg Plant uses a hidden cloud reveal
  via $0B5; see family-clouds.md.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank03.asm` (the shared egg-physics body + flavours
`$022/$023/$024/$025/$029/$02A/$02B`, lines 7541-8480),
`yi/Banks/Bank05.asm` (egg-block hop/landed cycle + post-hit
ballistic bounce, lines 189-466 and 16860-17000),
`yi/Banks/Bank07.asm` (Egg Plant + the BVZ-with-giant-egg payload
variant, lines 175-700 and 14225-14380),
`yi/Banks/Bank0F.asm` (Mock-Up Laid Egg, lines 2295-2370),
`yi/Banks/Bank02.asm` (Full Egg Spawner, lines 2670-2745),
`yi/Banks/Bank0D.asm` (Bowser-fight Giant Egg, lines 13110-13225).
Cross-verified against `yoshisisland-disassembly/disassembly/bank03.asm`
(Raidenthequick's labels `init_flashing_egg`, `init_egg`,
`init_giant_egg_frog`, `main_flashing_egg`, `main_egg`,
`main_giant_egg_frog`), `bank05.asm` (`init_egg_block`,
`main_flashing_egg_block`, `main_egg_block`,
`init_hit_green_egg_block`, `main_hit_green_egg_block`),
`bank07.asm` (`init_egg_plant`, `main_egg_plant`), `bank0F.asm`
(`init_red_1up_egg`, `main_red_1up_egg`), and `bank02.asm`
(`init_full_eggs`, `main_full_eggs`). See also: `ys_enmy.asm`.

---

## 1. Family at a glance

Thirteen sprites are in scope. Eight are projectiles or projectile-
shaped objects (the five small eggs, the three giants); three are
bouncing egg-blocks; one is the post-hit ballistic aftermath of the
green block; one is decorative; one is a pre-boss spawner; one is
the sprouting plant; plus the boss-fight giant egg cross-references
out to `docs/bossengine.md`.

| Sprite ID | Constant name | Bank | Init handler | Main handler | StompRt | Role |
|-----------|---------------|------|--------------|--------------|---------|------|
| `$022` | `FlashingEgg` | 03 | `$03:B742` `init_flashing_egg` | `$03:B86E` `main_flashing_egg` | `$03:9F9B` `head_bop_flashing_egg` -> `head_bop_common` | Yoshi-laid projectile that cycles palette via `CODE_03B75E`. Init runs the palette-cycle helper once then falls into shared `init_egg`. Main runs the cycle helper per-frame then falls into shared `main_egg`. |
| `$023` | `RedEgg` | 03 | `$03:B747` shared `init_egg` | `$03:B872` shared `main_egg` | `head_bop_common` (alias block) | Red-flavour ammunition. On enemy hit, the per-flavour hit-handler downstream of `CODE_03A2C7` awards 2 red coins. Init shares with $024 (generator-guard + sparkle queue); Main shares with all small + giant eggs. |
| `$024` | `YellowEgg` | 03 | `$03:B747` shared `init_egg` | `$03:B872` shared `main_egg` | `head_bop_common` | Yellow-flavour ammunition. On enemy hit, drops a coin shower (per-flavour branch downstream). Init and Main both share verbatim with $023. |
| `$025` | `GreenEgg` | 03 | `$03:B759` shared `init_giant_egg_frog` (RTL no-op) | `$03:B872` shared `main_egg` | `head_bop_common` | Standard-flavour ammunition. Init falls through to the no-op RTL because green eggs need no generator-guard / sparkle setup (they originate from Yoshi's lay path which has already done that work). Main shares with red/yellow/giant. |
| `$029` | `GiantEgg` | 03 | `$03:B759` shared `init_giant_egg_frog` (RTL) | `$03:B7B4` `main_giant_egg_frog` | `head_bop_common` | The Prince Froggy / Frog Pirate "wakeup" egg + a generic giant projectile. Main has a 2-stage lifecycle keyed on `$7AF8,x`: timer running -> render only (with brief $74A2 flash at expiry-2); timer expired -> spawn $061 BabyMario in-slot, clear freeze flags, restart music, fall through to shared `main_egg` at `CODE_03B83C`. |
| `$02A` | `RedGiantEgg` | 03 | `$03:B759` shared `init_giant_egg_frog` (RTL) | `$03:B872` shared `main_egg` | `head_bop_common` | Red giant-flavour projectile (lobbed by Frog Pirate, used in some boss setups). Same Main as small eggs but the giant-flavour branch inside `CODE_03BA57` substitutes an explosion-on-hit (`$61C6 = $0060`, `CODE_0294B4` POW-like detonation, `SoundID47_Explosion`). |
| `$02B` | `GreenGiantEgg` | 03 | `$03:B759` shared `init_giant_egg_frog` (RTL) | `$03:B872` shared `main_egg` | `head_bop_common` | Green giant-flavour projectile. Behaviourally identical to $02A; the family branch on giant-vs-small is `CMP #!Define_YI_NorSpr029_GiantEgg / BCC ...`, so $029, $02A, $02B all share the giant code path. |
| `$026` | `BowserFightGiantEgg` | 0D | `$0D:F8EA` `init_baby_bowser_egg` (RTL) | `$0D:F8FB` `main_baby_bowser_egg` | `head_bop_common` | The egg you ride during the Baby Bowser fight. Lives in `Bank0D` because it's wired into the giant-Bowser camera anchors `$1068/$106A/$106C` and the hit-counter at `$1074`. Cross-reference only; deep doc in `docs/bossengine.md`. |
| `$068` | `FlashingEggBlock` | 05 | `$05:80C4` `init_egg_block` (shared with $069/$06A) | `$05:80DD` `main_flashing_egg_block` | `head_bop_common` | Hopping block that yields a flashing-flavour egg. Init derives `$18,x = (SpriteID - $068) * 2 = 0` (per-flavour offset selector). Main runs an extra `CODE_03B75E` palette tick before falling into shared `main_egg_block`. |
| `$069` | `RedEggBlock` | 05 | `$05:80C4` shared | `$05:80E2` `main_egg_block` | `head_bop_common` | Same 2-state hop/land machine as $068, but `$18,x = 2` (selects the red-egg payload via `DATA_egg_block_state_ptr` + the bounce-tables). |
| `$06A` | `YellowEggBlock` | 05 | `$05:80C4` shared | `$05:80E2` `main_egg_block` | `head_bop_common` | Same machine, `$18,x = 4` (yellow). Note: the green block lives in a different sprite slot ($06B) because it has post-hit physics; the hop-block side of the family caps at flashing/red/yellow. |
| `$06B` | `GreenEggBlock` | 05 | `$05:FE1F` `init_hit_green_egg_block` | `$05:FE6E` `main_hit_green_egg_block` | `head_bop_common` | The **post-hit** state of a green-egg block: it's been bonked, now does a ballistic bounce, plays the SuperFX `FXCODE_0991D5` ground-probe, lands, and reverts to a Map16 tile via `CODE_change_map16` with tile word `$5F04`. The hop-cycle green block is a Map16 tile, not a sprite -- $06B is only the "thrown into the air" aftermath. |
| `$087` | `MockUpLaidEgg` | 0F | `$0F:90BF` `init_red_1up_egg` (RTL) | `$0F:90C0` `main_red_1up_egg` | `head_bop_common` | Decorative red 1-up egg (used in cutscenes / scoring-spectacles). 2-state `$16,x` machine: airborne -> on floor-touch ($7860 bit 0) zero velocity + 16-frame pop timer -> spawn smoke FX (`CODE_04F88E`) + 1-up score (`CODE_spawn_1up_score`) + despawn. |
| `$0AB` | `FullEggSpawner` | 02 | `$02:9A57` `init_full_eggs` (RTL) | `$02:9A58` `main_full_eggs` | `head_bop_common` | Pre-boss top-up. Init bare RTL. Main spawns `$025 GreenEgg` slots, attaches them to Yoshi's trail via `CODE_03BEB9`, plays `SoundID3A_StompShyGuy`, then despawns once the trail counter `$7DF6 >= $0C` (6 eggs * 2 bytes). |
| `$0CD` | `BaronVonZeppelinCarryingGiantEgg` | 07 | `$07:F1CB` `init_bvz_giant_egg` | `$07:F2A5` (shared `main_bvz_simple` body) | shared BVZ stub | Specialised payload variant of the Baron Von Zeppelin family. Stamps a payload index $18 into `$7A36,x` (instead of $06 for the bandit, $0A for the 1-up, etc.) then falls into the shared BVZ-drop dispatch. The dropped payload is sprite `$029 GiantEgg`. |
| `$0F4` | `SproutablePlantWithEgg` (EggPlant) | 07 | `$07:80C3` `init_egg_plant` | `$07:80F3` `main_egg_plant` | `head_bop_common` | The rooted plant that grows an egg Yoshi can pluck. 3-phase `$16,x` state machine (grow / ripe-egg / regrow) with a SuperFX-driven variant select via `DATA_egg_plant_variant_ptr` (regular green-egg variant or `$0163 BouncingNeedlenose` variant for the Yellow-Needlenose-Plant level). |

The base $025 GreenEgg is the canonical projectile; everything in
the $022-$02B range shares the same `main_egg` body and only
differs in (a) whether `init_flashing_egg` ran the palette tick,
and (b) the giant-vs-small branch inside `main_egg`'s shared
`CODE_03BA57`. The egg blocks ($068/$069/$06A) share Init/Main
with each other but **not** with the projectiles -- they're a
separate 2-state machine. $06B is unique: it's the **aftermath**
of a hit on the green block (the un-hit green block is a Map16
tile, never a sprite). The egg sources ($0087, $00AB, $00F4,
$00CD) are independent dispensers that each live in their own
bank.

Two notable structural observations:

- **Six sprite-IDs collapse into two physical bodies for Main**:
  `main_flashing_egg` ($022) + `main_egg` ($023/$024/$025/$02A/$02B) are
  fused such that $022 enters one instruction earlier and runs the
  palette tick, then falls through into the shared body. The giant
  `$029` is the only outlier (its own Main with the swallow-timer +
  Baby-Mario respawn, falling into the shared body only after the
  timer expires). All six call into `CODE_03B872 = main_egg` for
  the actual physics.
- **All four egg-source sprites are bare-RTL Inits**: $0087, $00AB,
  $0F4 (after the visual-variant prelude), and $0CD's Init does
  nothing but stamp the payload-index. The dispatch lives in
  Main.

---

## 2. The shared egg-physics body (`main_egg` at `$03:B872`)

The heart of the family. Every small egg ($022/$023/$024/$025) and
every giant egg ($02A/$02B, plus $029 once its wakeup timer
expires) runs this same physics body. Even the egg-block hop /
land logic ends by spawning a fresh egg sprite that runs into
this body.

```
main_egg ($03:B872):
    JSL CODE_03B9DD             ; gravity + hit-scan + floor-bounce
    ; (CODE_03B876 = continuation point used by giant-egg post-wakeup)
    LDA $78,x : BEQ ...         ; "active" gate: $78 = cooldown counter
        ; if cooldown still ticking, route to CODE_03B96D (held / arc-init)
    LDA $7A36,x : BPL ...       ; "is anim-timer ready?"
        ; BPL = high-bit clear -> not yet -> RTL
    LSR : BEQ +
        ; bit 0 set (mid-flight) -> if YSpeed positive (falling), go to bounce branch
        ; bit 0 clear (still airborne) -> stamp the anim-frame + sparkle and return
    +
    INC $16,x                    ; sub-state increment (cooldown advance)
    STZ $7402,x                  ; clear anim-frame
    LDA $18,x : BNE CODE_03B8FE  ; "has the egg landed yet?" $18 = 0/1 latch
    ; First-frame-on-ground path:
    LDY $7860,x : BNE CODE_03B8DA   ; $7860 = sprite-collision flags
    ; (otherwise -> bounce/bounce code)
    LDA #$0040 : STA $7542,x        ; "ground-bonk" magic
    LDA #$0400 : STA $75E2,x        ; sub-pixel Y-accel for bounce
CODE_03B8A8:                          ; "egg-in-trail" common entry point
    INC $18,x                       ; latch: "I've landed"
    LDA $7042,x : ORA #$0020         ; set OAM-priority-front bit
    STA $7042,x
    LDA $6FA0,x : AND #$FFBF : ORA #$0200 : STA $6FA0,x   ; OAM control word
    LDY #$01                          ; default: small-egg renderer bytes
    LDA SpriteID,x : CMP #$029
    BCC + : LDY #$1A                  ; if >= GiantEgg, switch to giant renderer
    +
    TYA : STA $00 : LDA $6FA2,x : AND #$FFC0 : ORA $00
    STA $6FA2,x                       ; merge renderer ID into bottom 6 bits
    RTL
```

`CODE_03B9DD` (the prelude) is the actual physics path -- it runs
every frame and contains:

- **Status-driven branch.** `$NorSpr_CurrentStatus` byte selects
  which of three flows runs: $08 (just-spawned-but-not-thrown) ->
  configure Y-velocity = `#$FBC0` (-1024 sub-pixels, upward),
  stamp X-velocity by mixing the sign of `$7C16,x` with `$60A8`
  (Yoshi's facing); $10 (active in flight) -> floor-bounce + glint
  spawn + cooldown-decrement; default -> short-circuit RTL.
- **Floor-hit on a giant egg.** Inside the $10 branch the code
  re-fetches the SpriteID and `CMP #!Define_YI_NorSpr029_GiantEgg`.
  If the egg is giant **and** `$7860,x & $01` is set (floor flag),
  the giant-flavour goes off:
  ```
  LDA #$0060 : STA $61C6                      ; arm explosion-flag
  JSL CODE_0294B4                              ; POW-like enemy clear
  JSL CODE_03B273                              ; spawn explosion particles
  STZ XSpeed,x
  LDA #!Define_YI_SoundID47_Explosion : JSL push_sound_queue
  PLA / PLY / RTL                              ; bail (don't continue physics)
  ```
  Small eggs just store renderer byte $3A into `$6FA2,x` and fall
  through to the standard glint-spawn at `CODE_03BA84`.
- **Glint trail.** When `($14 & 1) == 0` and freeze-flag clear,
  spawns `$AmbSpr1DF` (the egg-sparkle ambient) at the egg's
  position, copies a few palette bits, sets a per-glint TTL of 6
  frames, decrements two more timers ($73C2, $7782) for the trail
  fade. This is the sparkle stream visible behind a thrown egg.
- **Standard apply-velocity tail.** `JML CODE_03AF23` (the
  framework's generic gravity + sprite-table velocity-apply +
  collision-cell-resolve body).

### 2.1 Per-slot state held by an egg

Beyond the sprite-table standard (XPos `$70E2,x`, YPos `$7182,x`,
XSpeed/YSpeed via EXRAM mirror, OAM control words `$6FA0/$6FA2,x`,
collision flags `$7860,x`), the egg-physics body uses:

| Field | Meaning |
|---|---|
| `$16,x` | Cooldown / phase-advance counter. Incremented in `CODE_03B88E`. Combined with `$10` (high bit) drives the bob / wobble during the "egg ready to be thrown" phase via `CODE_03B9C6` (a sine-table lookup off `DATA_03B78A`). |
| `$18,x` | Landed-latch: 0 = still mid-flight (`CODE_03B8FE` won't run), non-zero = has bounced at least once (the renderer + sound logic kicks in). |
| `$76,x` | Carry-position sub-state index. Drives `CODE_03BDA1` (the "in Yoshi's carry slot" rotation around the player) -- 7-entry table `DATA_03B778` selects a target arc-position from $0002 to $007C. |
| `$78,x` | Active-after-throw cooldown. While non-zero, decrement in `CODE_03BA43` and route to `CODE_03B96D` (the in-arc / not-yet-collided path); when it hits zero, the egg is "live" for hit-scan. |
| `$7402,x` | Animation frame (forwarded to OAM builder). Egg-state set to 0 at the start of every Main pass; per-state branches add 1 or 2 to vary the wobble visual. |
| `$7542,x` | Ground-bonk hit-timer (16-frame default). Used both for floor-impact and for sprite-impact stomp gate. |
| `$75E2,x` | Sub-pixel Y-acceleration (gravity scaling). $0400 default. |
| `$77C0,x` | "Has fired the in-flight pickup sound" 1-bit latch (`SoundID20_SoaringEgg`). Cleared per-cycle. |
| `$7A36,x` | Anim timer ($14 & $0F mask drives wobble cadence). |
| `$7A96,x` | Air-hit secondary cooldown. |
| `$7A98,x` | Air-hit "did I just contact something" counter; drives the "bonk anim" alternation in `CODE_03B940`. |
| `$7AF6,x` | Stop-tracking cooldown for the explosion-glint phase. |
| `$7AF8,x` | **Giant-egg swallow timer** -- only meaningful for $029 (the wakeup egg). When non-zero, blocks the regular physics; on hitting 0, executes the BabyMario re-spawn. |
| `$7D36,x` | "Held-by" slot link (negative if not held). When BPL (positive) and Yoshi is not in a morph form (`!EXRAM_YI_Player_CurrentForm == 0`), enters `CODE_03BEB9` -- the "attach to Yoshi's trail" coupling. |
| `$7D38,x` | "Linked-to-Yoshi" non-zero flag -- companion to $7D36. Drives the "egg follows Yoshi by relative offset" position update in `CODE_03BD40`. |

### 2.2 The four observable phases of an egg

A live small egg cycles through four states from spawn to despawn,
all driven by the body above (no per-state table -- the phases
emerge from the latch combinations $78/$18/$7D38):

1. **Carry** (`$NorSpr_CurrentStatus == $08`, `$7D38 != 0`). Egg
   was just laid; it bobs behind Yoshi in the trail (`CODE_03BDA1`
   uses Yoshi anim frame `$60BE` as index into 2 x 256-byte
   `DATA_egg_carry_x_offsets` / `DATA_egg_carry_y_offsets` tables
   at `Bank03.asm:15465/15501`). Egg position is the player position
   plus an angle-of-facing-driven offset, refreshed every frame.
2. **Ready** (`$78 != 0`, `$7D38 != 0`). Yoshi has armed the aim
   reticle (`$60AB & $80`). Egg lifts to the over-head position
   via the 7-entry `DATA_03B778` arc table indexed by `$76,x`. The
   wobble visual is the sine-lookup at `DATA_03B78A`.
3. **In-flight** (`$NorSpr_CurrentStatus == $10`, `$78 == 0`, `$18 == 0`).
   Egg is detached from Yoshi, gravity applies (`CODE_03AF23`),
   sparkle trail emits ambient $1DF every odd frame, hit-scan
   checks via `CODE_03A2C7` set CarryFlag on overlap with an
   alive sprite (the per-flavour hit-handler downstream of
   `CODE_03B273` then runs).
4. **Bounced** (`$18 != 0`). Egg has hit floor / wall but not an
   enemy; bounces a few times via `CODE_03B940` (alternating
   between `DATA_03B8E4` for ground-bonk and `DATA_03B8F4` for
   wall-bounce -- both ~16-byte alternating squash anim tables).
   After the $7AF6 cooldown expires, the egg despawns via
   `CODE_03A31E` (free-slot path).

### 2.3 Sparkle / glint trail

The sparkle behind a thrown egg is generated inside `CODE_03B9DD`
between offsets `+$0B0` and `+$0F4` (Bank03.asm:8025-8044). Every
odd frame (when `$14 & $01 == 0`), spawn an `$AmbSpr1DF` at the
egg's current position, copy bits from `$7042,x` into the puff's
`$7002,y`, set its per-frame TTL to 6, and seed a few cross-fade
counters (`$73C2`, `$7782`, `$7E4C`). The sparkle is a separate
ambient sprite, not a sub-state of the egg.

The Red Coin Bandit's coin-link helper at `Bank0E.asm:11308`
(`CODE_0ED844`) is also called from `init_egg` for $023/$024 --
that routine packs the egg's screen position into the high byte
of `$701902,y` for the puff-pickup logic. It's reused by both
families.

---

## 3. Giant-egg variants ($029 / $02A / $02B)

### 3.1 $029 GiantEgg -- the Prince Froggy / Frog Pirate wakeup egg

The most distinctive member. Init is a no-op RTL shared with $025
and the two other giants. **Main is its own body** at `$03:B7B4`:

```
main_giant_egg_frog:
    LDA $7AF8,x : BEQ ->main_egg_at_03B83C   ; timer expired -> normal physics
    DEC $7AF8,x : BEQ wakeup                ; just expired -> wakeup
    CMP #$0002 : BNE +                       ; about to expire (timer == 2)
    LDA #$00FF : STA $74A2,x                 ; pre-expiry flash
    +
    RTL

wakeup:
    LDX/LDA FXCODE_0BC6B7 : JSL BeginSuperFXProcessing  ; clear shrink visual
    LDA #$0010 : TRB $7E08                                ; clear "swallowed-Yoshi" flag
    STZ Player_CurrentForm
    JSL CODE_04EF27                                       ; reset GFX banks
    LDA Player_YPos : ADC #$0004 : STA Player_YPos        ; nudge Yoshi up a bit
    LDA #$0008 : STA $60BE / $60C0                        ; reset anim + facing
    LDA #$FC00 : STA $60AA                                ; small upward kick
    STZ $60B4 / $60D2                                      ; clear sub-states
    JSL CODE_03BF87                                       ; detach
    JSL CODE_despawn_sprite_free_slot                     ; free this slot
    LDA #!Define_YI_NorSpr061_BabyMario                   ; *** spawn Baby Mario ***
    TXY : JSL CODE_spawn_sprite                            ;     in the just-freed slot
    LDA #$0002 : STA NorSpr_CurrentStatus,x                ; mark alive
    LDA Player_YPos : STA $7182                            ; align BabyMario sprite to player
    LDA Player_XPos : STA $70E2
    LDA #FXDATA_520000+$BC00 : STA $6114                   ; reset GSU dyntile pointer
    STZ Player_FreezeYoshiFlag / Level_FreezeSpritesFlag   ; clear all freeze flags
    STZ Global_PlayMusic                                   ; restart music
    JSL CODE_01B25E                                        ; resume music + restore HUD
    LDX $12 : RTL
```

So when Yoshi is swallowed (by Prince Froggy in W3-4 or Frog
Pirate in W5-extra), the **player slot transmutes into a giant
egg** with $7AF8 armed. The egg renders the swallow shape inside
the stomach via a SuperFX shape. When the timer expires (or Yoshi
exits the stomach), the egg slot is freed and a fresh BabyMario
slot is allocated in the same X.

The `$7AF8` swallow timer also has an immediate-expiry path
(`CMP #$0002 BNE`) that flashes `$74A2 = $00FF` two frames before
the wakeup -- this is the white-flash effect during the
"swallowed Yoshi reappearing" transition.

Once the wakeup completes, the egg-slot is gone and execution
never returns to `main_giant_egg_frog`. The fallthrough at the
top (timer == 0 on entry, `BEQ ->main_egg_at_03B83C`) is the path
used when the giant egg is being thrown as a generic projectile
(e.g. Frog Pirate's lob, or any future use of $029 as ammo).

### 3.2 $02A / $02B Red / Green Giant Eggs

Both are pure projectiles -- their Main is the shared `main_egg`
body, and the giant-flavour branch in `CODE_03BA57` swaps in the
explosion-on-floor-hit logic instead of the small-egg sparkle.
Init is the shared `init_giant_egg_frog` RTL (because both giants
are spawned by external code -- Frog Pirate's projectile spawn in
Bank0E, BVZ-with-giant-egg in Bank07 -- which has already
positioned them).

The giant-vs-small branch is `CMP #!Define_YI_NorSpr029_GiantEgg /
BCC small_path` -- so $029, $02A, $02B all take the same giant
path inside the body. The reason the giant uses the explosion is
visual scaling: small eggs leave a sparkle that fades, giants
detonate (matching the player's "I just hit something the size of
me" expectation).

### 3.3 $026 BowserFightGiantEgg (cross-reference only)

Lives in `Bank0D.asm:13110-13225`. **Not** part of the egg-physics
family; it has its own Main body that reads camera anchors
`$1068/$106A/$106C`, hit-counter `$1074`, and freeze flag
`$7B56`. The sprite is rideable (its StompRt routes to the shared
common body but the ride physics are inside `main_baby_bowser_egg`
itself). Spawns either `$091 4-RedToadies` or coins / stars on
contact via `DATA_0DF8EB` (16-byte even-spread weighting table).

See `docs/bossengine.md §7.4 (Baby Bowser fight)` for the full
state machine.

---

## 4. Egg blocks ($068 / $069 / $06A / $06B)

Three are hop/landed cycles ($068 / $069 / $06A); the fourth
($06B) is the unique post-hit aftermath of the green block.

### 4.1 The shared hop/landed machine ($068 / $069 / $06A)

Three sprite IDs collapse to one Init and one Main pair at
`Bank05.asm:203-465`. Init:

```
init_egg_block:
    JSL CODE_03D406                        ; standard sprite setup (clear $76, etc.)
    LDA SpriteID,x
    SEC : SBC #!Define_YI_NorSpr068_FlashingEggBlock   ; { 0, 1, 2 }
    ASL                                                ; { 0, 2, 4 }
    STA $18,x                                          ; per-flavour offset
    LDA #$0100 : STA $7A36,x                          ; initial anim cooldown
    RTL
```

The variant-encoding trick: `SpriteID - $068` resolves to {0, 1,
2} for flashing / red / yellow; doubled to {0, 2, 4} and stored
in `$18,x`. The offset indexes into two parallel tables further
down:

- `DATA_058228` (3 entries `$FC00 / $FEC0 / $FC00`) -- the
  "Y-impulse on hop" velocity. Note flashing & yellow share
  `$FC00`; red is the gentler `$FEC0`.
- `DATA_05822E` (3 entries `$0040 / $0012 / $0040`) -- the
  ground-bonk cooldown frames. Red has a much shorter $12 = 18
  frames vs the others' $40 = 64 frames.

So per-flavour the only meaningful behavioural difference is
**red has a faster hop cycle** (smaller upward kick, shorter
between-hops cooldown). Flashing and yellow are byte-identical
except for the palette tick.

Main dispatch is a 2-entry table at `DATA_egg_block_state_ptr`:

| `$76,x` | Handler | Role |
|---|---|---|
| `$00` | `CODE_058234` | **Hop / bounce phase.** Test if Yoshi is in flutter-jump (`$60AB` negative) and on top of this block (overlap check), if so consume the block-on-touch and apply the upward bounce; otherwise just update the bob anim via the SuperFX call. |
| `$02` | `CODE_05827D` | **Landed phase.** Egg-block has been picked. Lock the Y-pos to the recorded "rest" Y, set `$74A0 = $FF` (death-flash), spawn the corresponding egg sprite via `CODE_spawn_sprite` (sprite ID = $022 + $18>>1), call `CODE_0ED844` (sparkle queue), then jump into `CODE_03B8A8` (the egg-in-trail attach entry point from §2 above), play `SoundID3A_StompShyGuy`. |

The block-to-egg handoff is the critical bit: the picked block
**immediately becomes an egg in Yoshi's trail** by spawning the
egg sprite, calling `CODE_03B8A8` from inside the block's slot
(with the egg in `Y`), and then letting the block's slot RTL.
Yoshi's egg counter `$7DF6` is bumped one slot.

The bouncing-physics tables at `DATA_05813D` / `DATA_058149` are
6-entry low/high Y-velocity caps -- they clamp the hop arc so
the block can't bounce past the screen edges.

### 4.2 $06B GreenEggBlock -- post-hit ballistic aftermath

The un-hit green block lives in the Map16 layer (not as a sprite).
When Yoshi hits it (via bump-from-below from above), the level-
data engine swaps the Map16 tile for sprite $06B at the same
position; $06B then bounces ballistically for a moment, runs
a SuperFX `FXCODE_0991D5` ground-probe, and once landed reverts
the position back to a Map16 tile via `CODE_change_map16` with
tile word `$5F04`.

```
init_hit_green_egg_block:
    JSL CODE_03AD74                         ; "above-the-block test" (used to determine bounce direction)
    BCC + : JSL CODE_05FF7E                  ; if above, run upward-launch helper
    LDA $7040,x : CLC : ADC #$1801 : STA $7040,x   ; merge palette+priority for OAM
    +
    INC $0C02                                 ; global egg-block counter
    LDA $70E2,x : STA $18,x                   ; remember spawn-X as low byte (uses lower 16 bits of $18)
    LDA $7182,x : STA $76,x                   ; remember spawn-Y as state byte
    LDA $70E2,x : SEC : SBC Player_XPos : STA $78,x  ; direction-of-launch flag
    RTL
```

Main:

```
main_hit_green_egg_block:
    LDA $7722,x : ORA $7362,x : BMI +        ; if no flutter/jump animation override
    JSL CODE_03AA52                          ;     run the standard sprite OAM
    +
    JSL CODE_03AF23 : JSL CODE_03D127        ; gravity + collision-cell resolve
    LDY $7D36,x : DEY : BMI +                ; if held by another sprite slot,
        LDA NorSpr_CurrentStatus,y : CMP #$10 : BNE +
        LDA $6FA2,y : AND #$0800 : BEQ +      ; and that other slot is in "egg-in-trail" mode,
        TYX : JSL CODE_03B24B                 ; force-detach it (so the green-block can't be carried)
    +
    LDA $7A38,x : BPL +                      ; if airborne (sign bit clear),
        ; ...ballistic descent...
    +
    ; Landed path:
    LDA $18,x : STA $0091                    ; recover spawn-X
    LDA $76,x : STA $0093                    ; recover spawn-Y
    LDA #$0001 : STA $008F                   ; layer = main
    LDA #$5F04 : STA $0095                   ; revert to green-egg-block Map16 tile
    JSL CODE_change_map16                    ; *** restore the Map16 tile ***
    LDX $12 : JML CODE_03A31E                ; despawn self
```

The Map16-tile-restore-on-land is unusual -- most sprite-killed
blocks just despawn and leave a gap. The green-egg block is
designed to **always be restorable**: as long as Yoshi doesn't
pick the egg up mid-flight, the block reverts to Map16 and can
be hit again.

Inside the descent phase, the sprite reads the SuperFX result
register `R6` against `$0006` (a tile-density count) and may
spawn a fresh `$0025 GreenEgg` sprite via `CODE_spawn_sprite_init`
with per-frame X/Y velocity picked from 8-entry tables
`DATA_05FE4A` / `DATA_05FE5A` (indexed by the global frame
counter `$0C02 & $0007`). This is the "block shatters into a
shower of eggs if there's room" effect when the player hits the
block while Yoshi already has the inventory full.

---

## 5. Egg source sprites ($0087 / $00AB / $00CD / $00F4)

The dispensers and decorative pieces that feed eggs into play
from outside the projectile/block cluster.

### 5.1 $0087 MockUpLaidEgg (decorative)

Drops from the sky as a one-shot cinematic effect (used in the
"laying a 1-up" set piece). Init is bare RTL. Main is a 2-state
machine driven by `$16,x`:

| `$16,x` | Handler | Role |
|---|---|---|
| `$00` | `CODE_0F90CE` | Falling. Watch `$7860 & $1` (floor flag); on land, zero `XSpeed`, set 16-frame pop timer `$7A96 = $0010`, transition to state $02. |
| `$02` | `CODE_0F90E6` | Landed pop. When `$7A96` expires, save XPos / YPos / palette bits into scratch `$0000-$0004`, call `CODE_04F88E` (smoke effect spawner), call `CODE_spawn_1up_score` (the "1up" score popup), free the slot via `CODE_despawn_sprite_free_slot`. |

This is the only egg sprite that yields a 1-up directly. The
score is awarded by `CODE_spawn_1up_score` (the standard 1-up
scoring helper) -- no per-flavour branch.

### 5.2 $00AB FullEggSpawner (pre-boss top-up)

Placed by level data right before a boss arena to restore
Yoshi's egg trail to 6 eggs. Init is bare RTL; Main is a tight
loop that drops one egg per frame until the trail counter
$7DF6 hits $000C (6 eggs * 2 bytes per slot):

```
main_full_eggs:
    JSL CODE_03B69D                        ; "is Yoshi airborne and in normal form?"
    LDA $7542,x : BNE +                    ; one-time SFX
        LDA #!Define_YI_SoundID3A_StompShyGuy : JSL push_sound_queue
        LDA #$0040 : STA $7542,x
    +
    LDA $7182,x : SEC : SBC Player_YPos    ; "is Yoshi below the spawner?"
    CMP #$0010 : BMI .skip
    LDA #$0025                             ; *** spawn GreenEgg ***
    JSL CODE_spawn_sprite_active           ; (active spawn)
    BCS .got_one
        ; (slot table full -> try in-slot variant)
        LDA #$0025 : TXY : JSL CODE_spawn_sprite
        LDA Player_YPos : ADC #$0010 : STA $7182    ; align to Yoshi
        JSL CODE_03BEB9                              ; attach to trail
        BRA .check_full
    .got_one:
        LDA $70E2,x : STA $70E2,y                    ; copy our X to the new egg
        LDA Player_YPos : ADC #$0010 : STA $7182,y    ; align Y
        PHX : TYX : STX $12 : JSL CODE_03BEB9         ; attach the new egg to trail
        PLX : STX $12
    .check_full:
        LDA $7DF6 : CMP #$000C : BCC +                ; trail full?
        JSL CODE_03A31E                                ; yes -> despawn the spawner
    +
        STZ !RAM_YI_Level_ItemBeingUsed                ; release the "egg-throw" lock
        RTL
    .skip:
        ; ...special-case: Yoshi off-screen -> spawn fresh egg above Yoshi...
        RTL
```

The spawner doesn't trust the slot-allocator: it tries an
"active spawn" (which can fail if the table is full), and if
that fails it overwrites **its own slot** with a fresh egg (and
then re-finishes by re-checking the trail count). This is one of
the rare places in the codebase where a sprite intentionally
replaces itself with a different sprite ID.

The `$ItemBeingUsed = 0` write at the end is important -- the
egg-throw aiming UI is gated by this byte; the spawner clears
it so Yoshi can throw the freshly-acquired eggs immediately.

### 5.3 $00CD BVZ-CarryingGiantEgg (payload variant)

A Baron Von Zeppelin balloon carrying a giant egg as its drop
payload. Init at `Bank07.asm:14228`:

```
init_bvz_giant_egg:
    LDA #$0018 : STA $7A36,x          ; payload-index $18 (giant-egg slot in table)
    LDA #$FFFF : STA $78,x            ; "armed but unspawned" flag
    LDA $7400,x : TAY                  ; spawn-side direction
    LDA DATA_07F114,y : STA XSpeed,x   ; per-side X-velocity (mirror table)
    SEP #$20
    LDA $10 : AND #$03 : TAY           ; pseudo-random in 0..3
    LDA DATA_07F10C,y : STA $18,x      ; per-frame anim cooldown
    REP #$20
    LDA #$0800 : STA $75E2,x           ; gravity scale
    LDA #$0004 : STA $7542,x           ; 4-frame ground-bonk
    RTL
```

The payload-index $18 is the giant-egg slot in the shared BVZ
drop-table (`DATA_07F7BD` maps payload-indices to drop handlers).

**The spawned sprite ID is `$026 BowserFightGiantEgg`, NOT `$029` GiantEgg**
(per asm trace, `DATA_bvz_payload_sprite_ids[$18]` =
`!Define_YI_NorSpr026_BowserFightGiantEgg`; the drop handler
`CODE_07F9AD` calls `CODE_spawn_sprite` with this value in A).
But `$026` is NOT functionally equivalent to `$029` here -- the
two SpriteIDs route through genuinely different code paths via
`CODE_03BB1D`'s explicit `SpriteID CMP #$029` checks, and `$026`
is being used AS A FLAG to select the BVZ-projectile branch.

`$026`'s Main (Bank0D:13130) dispatches on two flags first:

- If `$7D38,x != 0` -> bowser-fight cinematic-egg path (the
  state machine for the "egg-you-ride-to-fight-Bowser" sequence)
- Else `JMP CODE_0DFA74`:
  - If `$78,x != 0` -> `JMP CODE_0DFA8F -> JSL CODE_03BB1D`
    (engine hatch / projectile path)
  - Else -> ground-bonk despawn (`CODE_03A590`)

`init_bvz_giant_egg` (Bank07:14233) pre-arms `$78,x = $FFFF`
before the drop. `CODE_spawn_sprite` zeroes `$7D38,x` during the
spawn but does NOT zero direct-page `$78,x` -- so post-spawn,
`$026`'s Main reaches `CODE_03BB1D` with `$78` non-zero.

Inside `CODE_03BB1D` (Bank03.asm:8068) the BVZ-`$026` path
diverges from `$029` at two sites:

1. **Line 8138**: `CMP SpriteID, #$029 / BCC CODE_03BBB4`. `$026` <
   `$029` -> BCC taken, skipping the `$029`-specific
   "BPL $7FE8 cleanup" branch.
2. **Line 8155**: `CMP SpriteID, #$029 / BCC CODE_03BBE4`. Same
   verdict -- skips the cinematic-giant-egg setup (which writes
   `$7542=$60` + `$75E2=$0600` for `$029` and jumps to
   `CODE_03BCD9`).

`$026` ends up at `CODE_03BBE4` -> not HuffinPuffin -> falls
through to `CODE_03BC53`, which plays `SoundID20_SoaringEgg` and
sets up a SuperFX arc-velocity launch via `FXCODE_09907C`.
So the BVZ giant egg is a **distinct projectile flavour** --
`$029`'s `$7AF8`-timer-driven wakeup path (which spawns Prince
Froggy/Frog Pirate) is bypassed.

The naming `BowserFightGiantEgg` for `$026` is misleading -- the
sprite is dual-role: Bowser-fight cinematic egg AND BVZ-projectile
flag.

Historical context for the name confusion: the spawned sprite is
*labelled* for the Bowser fight but is *used* as a regular giant-egg
projectile here. If you need a clean canonical name for the
projectile semantic role, point at `$029`; if you need the actual
SpriteID-in-slot, it's `$026`.

### 5.4 $00F4 SproutablePlantWithEgg (Egg Plant)

The largest of the egg-source sprites by code volume (~500 lines
of Main). 3-phase `$16,x` state machine driven by a 3-entry
`DATA_egg_plant_state_ptr` at `Bank07.asm:233`:

| `$16,x` | Handler | Role |
|---|---|---|
| `$00` | `CODE_07813D` | **Grow.** Cycle through 4 frame indices (`DATA_078119 = $02 / $01 / $02 / $00`) gated by per-frame timer `DATA_07811D = $04 / $02 / $02 / $04`. After all 4 frames roll, advance to state $02 and jump into the variant-dispatch (`DATA_egg_plant_variant_ptr`). |
| `$02` | `CODE_07838A` | **Ripe-egg.** The egg is sitting on the plant ready to be plucked. Cycle pose `$09 / $0A / $09 / $08` from `DATA_078382`. After all 4 frames roll, advance to state $04. |
| `$04` | `CODE_0783C9` | **Plucked / regrow.** Cycle pose `$07 / $06 / $00` from `DATA_0783C6` (the wilted-then-reset visual). When done, reset back to state $00 (grow) and the cycle restarts. |

The variant-dispatch on transition $00 -> $02 is a 2-entry table
keyed by `EXRAM_GenericTable701900,x`:

| Index | Handler | Variant |
|---|---|---|
| $0 | `CODE_07817F` | Standard green-egg plant. SuperFX `FXCODE_0991D5` ground-probe checks for room; if Yoshi is close (`R6 < 6` overlap), spawn a `$0025 GreenEgg` via `CODE_spawn_sprite_active` with X-velocity from `DATA_078121` (8-entry signed table) + Y-velocity $FA00 (upward kick) + `SoundID14_Gulp`. Otherwise spawn `$AmbSpr1DF` puff. If the player is *very* close (R6 == 5), spawn up to 4 eggs in sequence with alternating X-velocities from `DATA_078131`. |
| $1 | `CODE_078297` | Needlenose-variant plant. Same general shape but spawns `$0163 BouncingNeedlenose` instead of GreenEgg, and uses a 2-step probe via `FXCODE_0991D5` + `FXCODE_0991DB` for tighter aim. Used in the Yellow-Needlenose-Plant level only. |

The variant-bit is picked at Init time from `$70E2,x & $10` (a
level-data layout bit), so the level designer can stamp either
variant into the same sprite slot.

`CODE_078425` (the post-Main render hook) runs every frame: it
calls `FXCODE_09933A` to test whether the plant is being plucked
(SuperFX intersection with Yoshi's tongue), and on positive
result (sprite-Y past the player by sign-test) transmutes the
slot via `CODE_03A366` (in-slot sprite-ID change to the plucked-
egg variant). This is the "Yoshi licks the egg off the plant"
mechanic.

---

## 6. Yoshi's egg-trail interaction

The egg-trail is the line of carried eggs that follow Yoshi.
The trail is described by:

- **`$7DF6` (SRAM)** -- 1-byte count of eggs in trail times 2
  (so $0C = 6 eggs, the maximum). `!EXRAM_YI_Level_EggInventorySizeLo`
  in `yi/Memory/SRAM_LevelState.asm:11`.
- **`$7DF8,x` (SRAM)** -- 6 word slots; each slot is the sprite
  table index of the corresponding egg sprite.
  `!EXRAM_YI_Level_EggInventoryIndices` at `SRAM_LevelState.asm:13`.

The flow from sprite-side to inventory-side:

1. **Pickup** -- block hits floor / plant is plucked / spawner
   spawns. The egg sprite is freshly born with
   `NorSpr_CurrentStatus = $0008` (just-spawned, not-thrown).
2. **Attach** -- `CODE_03BEB9` (`Bank03.asm`, ~7-instruction
   helper) writes the egg slot to `$7DF8,$7DF6` and bumps `$7DF6`
   by 2.
3. **Carry** -- on every Main pass, while `$NorSpr_CurrentStatus
   == $08` and `$7D38 != 0`, the egg's position tracks Yoshi via
   `CODE_03BDA1` + `DATA_egg_carry_y_offsets` (a 256-entry signed
   Y-offset table indexed by Yoshi anim frame `$60BE`).
4. **Throw** -- when the player taps the throw button:
   `!RAM_YI_Level_ItemBeingUsed` -> 1, the active egg lifts to
   the over-Yoshi arc via `DATA_03B778`, status flips to $10
   (active in-flight), `$78,x` is cleared, and the egg becomes a
   live projectile.
5. **Despawn** -- on enemy hit (`CODE_03B273` ambient-cleanup +
   per-flavour score/coin path), on wall-bounce expiry (`$7AF6
   == 0`), or off-screen via `CODE_03A2C7`.

Sprites that **consume** trail slots (decrementing $7DF6):

- $022 / $023 / $024 / $025 -- a fresh egg-block pickup adds to
  the trail; throwing consumes one slot when status flips.
- The shared `CODE_03B273` (death-pop spawner used by all egg
  flavours) removes the egg from the trail and frees its slot.

Sprites that **add** to the trail:

- $068 / $069 / $06A on consumption (`CODE_05827D` calls
  `CODE_03B8A8` which is the in-trail attach point).
- $0F4 on pluck (the Egg Plant), via `CODE_03BEB9`.
- $0AB on spawn (`main_full_eggs` calls `CODE_03BEB9` after
  each successful spawn).

Sprites that **do not** touch the trail:

- $029 / $02A / $02B / $026 -- the giants are externally spawned
  projectiles that never enter Yoshi's trail (you can't lay a
  giant). They're owned by their spawner (Frog Pirate, BVZ,
  Baby Bowser fight).
- $0087 -- a decorative landed egg, never picked up.
- $0CD -- the BVZ balloon; the giant-egg payload it drops is
  also external.

Note: the **green-egg-from-block** flow goes through `CODE_03B8A8`
which is the SAME entry point that `main_egg` falls into when an
egg first lands. So an egg-from-block and an egg-just-landed
visually do the same thing -- they both stamp the OAM renderer
ID (1 for small, $1A for giant) into `$6FA2,x` and set the
"in-trail" OAM-priority bit.

---

## 7. Spawn / parent relationships

Where do egg-family sprites come from in a level?

| Source | Mechanism | Notes |
|---|---|---|
| Yoshi's "lay" action | `CODE_03BEB9` inside Bank04 player code | Spawns the small egg flavour matching Yoshi's current trail palette. |
| Level data | Sprite-list entry $068 / $069 / $06A | Direct level-data spawn of the block. `init_egg_block` picks the per-flavour offset. |
| Level data | Sprite-list entry $0F4 | Direct level-data spawn of the Egg Plant. |
| Level data | Sprite-list entry $0AB | Direct level-data spawn of the Full Egg Spawner, typically immediately before a boss room. |
| Level data | Sprite-list entry $0CD | Direct level-data spawn of the BVZ-with-giant-egg balloon. |
| Level data | Map16 tile $5F04 hit | The unhit green-egg block lives as a Map16 tile; on hit, the level-data engine swaps it for sprite $06B (the post-hit ballistic). |
| Egg Plant ripe phase | `CODE_07817F` -> `CODE_spawn_sprite_active` | Spawns $0025 GreenEgg from `$0F4`. |
| Frog Pirate boss | Bank0E body | Spawns $029 GiantEgg as wakeup payload (via the swallow cinema -- the player slot transmutes). |
| Prince Froggy boss | Bank02 body | Same mechanism as Frog Pirate -- player slot transmutes into $029. |
| BVZ-with-giant-egg | `CODE_07F82C`-equivalent giant-egg drop handler | When the balloon drops its payload, spawns $029 in the freed slot. |
| Baby Bowser fight | Bank0D body | Spawns $026 BowserFightGiantEgg as a phase trigger. |
| Hit on green-egg block | $06B post-hit aftermath | $06B's land-handler may spawn up to 4 fresh $0025 GreenEggs via the dense-tile branch. |
| Mock-Up Laid Egg | Cutscene only | Spawned by gamemode-side scripting, not by another sprite. |

Three interesting details:

**Slot transmute vs. slot spawn.** Most spawners create new
sprite slots. But $0AB (FullEggSpawner), Prince Froggy, and Frog
Pirate **transmute their own slot** into the new sprite. $0AB does
it as a fallback when `spawn_sprite_active` fails (slot table
full); the bosses do it as the normal mechanism. The Bowser-fight
giant egg also re-uses Yoshi's player slot indirectly via the
$1074 hit counter.

**The block-to-egg handoff is a sprite-ID change in two steps.**
The block ($068/$069/$06A) spawns the egg with a *different*
sprite ID via `CODE_spawn_sprite` (in a different slot), then calls
`CODE_03B8A8` *from inside the block's slot* with the new egg in
Y. This is unusual -- most spawners write to the new slot only
via the new-slot index Y. Here the routine sets the egg's
position from the block's perspective.

**Level-data-spawned eggs are rare.** The framework supports
spawning $0022-$002B directly via the sprite list, but no
shipping level uses this -- the eggs are always created
indirectly via a block, plant, spawner, or Yoshi's lay action.
The level-data-spawn path is the same Init that runs after
`spawn_sprite` so behaviour is identical, but it's a dormant
code path in practice.

---

## 8. The variant-encoding mechanism (engine archaeology)

Three different encoding patterns across the family:

**Pattern A: SpriteID-difference as table-offset.** Used by
`init_egg_block`:

```
LDA SpriteID,x : SEC : SBC #!Define_YI_NorSpr068_FlashingEggBlock
ASL : STA $18,x
```

Three sprite-IDs -> ASL'd index {0, 2, 4} into 3-entry tables
selecting hop velocity + cooldown. Identical structure to the
"Bandit-under-cover" pattern in `family-bandits.md §5 Pattern A`.

**Pattern B: SpriteID-as-conditional-branch.** Used by `main_egg`
to distinguish small-vs-giant:

```
LDA SpriteID,x : CMP #!Define_YI_NorSpr029_GiantEgg
BCC small_path
```

The small/giant divide is encoded as a single `CMP` -- because
$029, $02A, $02B all sit above $029 numerically, the branch
naturally captures all three giants. The downstream consumers
(at least 11 sites in the codebase per `grep` of
`!Define_YI_NorSpr02B_GreenGiantEgg+$01`) all use the symmetric
upper-bound check `< $02C` for "is this any kind of egg".

**Pattern C: Shared label, fall-through Init.** The most
distinctive pattern in this family:

```
YI_NorSpr022_FlashingEgg_Init:
init_flashing_egg:
    JSL CODE_03B75E                ; palette tick (flashing-only)
YI_NorSpr023_RedEgg_Init:
YI_NorSpr024_YellowEgg_Init:
init_egg:                          ; shared init (red+yellow)
    LDA $701902,x : BNE +          ; "already-init'd" guard
    JSL CODE_03D3F8                ; "spawned from generator? skip"
    BEQ ++ : JML CODE_despawn_sprite_free_slot   ; (bail if from generator)
    ++
    JSL CODE_0ED844                ; sparkle queue setup
YI_NorSpr025_GreenEgg_Init:
YI_NorSpr029_GiantEgg_Init:
YI_NorSpr02A_RedGiantEgg_Init:
YI_NorSpr02B_GreenGiantEgg_Init:
init_giant_egg_frog:               ; shared init (green + all giants)
    +
    RTL
```

**Six sprite-IDs and seven labels collapse to three physical
bodies.** The flashing egg's palette tick falls through into
red/yellow's generator-guard, which falls through into green's
RTL (which is the same RTL that the three giants use). One
linear sweep of code; no jumps; no duplicated work.

The same trick on the Main side:

```
YI_NorSpr022_FlashingEgg_Main:
main_flashing_egg:
    JSL CODE_03B75E             ; palette tick (per-frame)
YI_NorSpr023_RedEgg_Main:
YI_NorSpr024_YellowEgg_Main:
YI_NorSpr025_GreenEgg_Main:
YI_NorSpr02A_RedGiantEgg_Main:
YI_NorSpr02B_GreenGiantEgg_Main:
main_egg:                        ; shared body
    JSL CODE_03B9DD              ; gravity + hit + bounce + sparkle
    ; ...rest of body...
```

Five sprite-IDs and six labels collapse to two physical bodies
on the Main side -- but $029 is the outlier (its own pre-body
that runs the swallow-timer before falling into the shared
post-prelude entry point `CODE_03B876`).

This is one of the densest collapsing groups in the YI sprite
engine. The Bandit family (`family-bandits.md §5 Pattern C`)
collapses four labels to two; the Egg family collapses seven
to three (Init) and six to two (Main).

---

## 9. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` -- canonical sprite IDs and
  one-line summaries for `$022`, `$023`, `$024`, `$025`, `$026`,
  `$029`, `$02A`, `$02B`, `$068`, `$069`, `$06A`, `$06B`,
  `$0087`, `$00AB`, `$00CD`, `$00F4`.
- `docs/spritestateengine.md` -- the engine-side 9-state
  dispatcher that runs each Main + the shared `head_bop_common`
  body for all egg StompRts.
- `docs/bossengine.md` -- Prince Froggy ($045), Frog Pirate
  ($017), Baby Bowser fight ($026 / $134). The wakeup-egg
  mechanism in §3.1 is invoked by Prince Froggy / Frog Pirate
  swallow cinematics.
- `docs/family-misc.md §2` -- the Watermelon family is the
  parallel projectile cluster with the same physics body shape
  (gravity + bounce + ambient-puff spawn). Eggs and watermelons
  share the `head_bop_common` alias block in `Bank03.asm`.
- `docs/family-clouds.md` -- Winged-Cloud-with-Coin variants and
  the hidden-cloud reveal mechanic (Egg Plant's variant select
  is structurally similar).
- `docs/leveldataengine.md` -- how Map16 tile $5F04
  (un-hit green-egg block) is swapped for sprite $06B on hit.
- `yi/Banks/Bank03.asm` -- the entire shared physics body:
  `init_flashing_egg` (7551), `init_egg` (7555), `init_giant_egg_frog`
  (7569), `CODE_03B75E` palette tick (7580), `main_giant_egg_frog`
  (7612), `CODE_03B83C` shared post-wakeup entry (7669),
  `main_flashing_egg` / `main_egg` (7701 / 7705), `CODE_03B9DD`
  prelude (7898), `CODE_03BA57` giant-flavour floor-hit (7960),
  `CODE_03BA84` standard glint-spawn (7981), `CODE_03BD2E` carry
  offset apply (8288), `CODE_03BDA1` Yoshi-trail rotation (8337),
  `DATA_egg_carry_x_offsets` (15465), `DATA_egg_carry_y_offsets`
  (15501). The giant `head_bop_*` StompRt alias block at 2810-3289.
- `yi/Banks/Bank05.asm` -- egg-block bodies: `init_egg_block`
  (206), `DATA_egg_block_state_ptr` (226), `main_flashing_egg_block`
  (235), `main_egg_block` (241), `CODE_058234` hop handler (407),
  `CODE_05827D` landed handler (440), `DATA_058228` Y-impulse
  (401), `DATA_05822E` cooldown (404). Plus the post-hit:
  `init_hit_green_egg_block` (16870), `main_hit_green_egg_block`
  (16903), `DATA_05FE4A` / `DATA_05FE5A` X/Y velocity (16894-16897),
  `DATA_05FE6A` ballistic table (16899).
- `yi/Banks/Bank07.asm` -- Egg Plant + BVZ-giant-egg: `init_egg_plant`
  (183), `main_egg_plant` (214), `DATA_egg_plant_state_ptr` (234),
  `DATA_egg_plant_variant_ptr` (284), `CODE_07817F` standard
  variant (288), `CODE_078297` needlenose variant (407),
  `CODE_07838A` ripe-phase (519), `CODE_0783C9` regrow-phase
  (554), `CODE_078425` pluck-probe (606). Plus BVZ:
  `init_bvz_giant_egg` (14229) + the shared `main_bvz_simple`.
- `yi/Banks/Bank02.asm` -- `init_full_eggs` (2675), `main_full_eggs`
  (2682). Plus the cross-reference to Prince Froggy at 7799 (Init)
  / 7963 (Main).
- `yi/Banks/Bank0D.asm` -- `init_baby_bowser_egg` (13116),
  `main_baby_bowser_egg` (13129), `DATA_0DF8EB` payload-weight
  (13123).
- `yi/Banks/Bank0F.asm` -- `init_red_1up_egg` (2316),
  `main_red_1up_egg` (2326), `DATA_0F90CA` state-ptr (2333),
  `CODE_0F90CE` falling (2337), `CODE_0F90E6` landed-pop (2350).
- `yi/Memory/SRAM_LevelState.asm` -- `!EXRAM_YI_Level_EggInventorySizeLo`
  (11), `!EXRAM_YI_Level_EggInventoryIndices` (13).
- `yi/Memory/SRAM_Player.asm` -- the egg-throw aiming state
  cluster: `!EXRAM_YI_Player_EggThrowStateMachine` (100),
  `!EXRAM_YI_Player_EggCursorRadius` (103), `_EggCursorX/Y`
  (106-109), `_EggCursorLockedFlag` (114), `_CanAimEggFlag`
  (117), `_EggAimAngle` (119), `_EggCursorAngVel` (123). All
  consumed by the player-side egg-throw routine in Bank04.
- `yoshisisland-disassembly/disassembly/bank03.asm` --
  Raidenthequick's labels: `init_flashing_egg`, `init_egg`,
  `init_giant_egg_frog`, `main_flashing_egg`, `main_egg`,
  `main_giant_egg_frog`.
- `yoshisisland-disassembly/disassembly/bank05.asm` --
  `init_egg_block`, `main_flashing_egg_block`, `main_egg_block`,
  `init_hit_green_egg_block`, `main_hit_green_egg_block`.
- `yoshisisland-disassembly/disassembly/bank07.asm` --
  `init_egg_plant`, `main_egg_plant`, `init_bvz_giant_egg`.
- `yoshisisland-disassembly/disassembly/bank0F.asm` --
  `init_red_1up_egg`, `main_red_1up_egg`.
- `yoshisisland-disassembly/disassembly/bank02.asm` --
  `init_full_eggs`, `main_full_eggs`.
- `ys_enmy.asm` -- parallel asm for the egg projectile-physics
  body; shares the small-vs-giant CMP gate and the
  multi-sprite-ID Init/Main collapse pattern documented in §8.
- `ys_chr.asm` -- parallel asm for Yoshi's lay/throw action and
  the trail-pickup helper `CODE_03BEB9`.

---

## 10. Open questions

- **`DATA_058228` Y-impulse asymmetry.** Flashing and yellow
  blocks share `$FC00` (a vigorous upward kick); red is the
  gentler `$FEC0`. The author intent is unclear -- visually, red
  blocks hop *less* than flashing/yellow. Was this a balancing
  choice (red eggs are the prize coin variant, so the block hops
  less to make it easier to catch in mid-air)? Or an
  authoring-time mistake never corrected? The cooldown ratio at
  `DATA_05822E` is also asymmetric (red is 18 vs 64 frames).
- **The "active spawn" -> "in-slot transmute" fallback in $0AB.**
  `main_full_eggs` first tries `CODE_spawn_sprite_active` and
  falls back to overwriting its own slot via `CODE_spawn_sprite`.
  This means a level with a full slot table at the moment $0AB
  fires could see the spawner *vanish* (replaced by a single egg)
  instead of cycling through the full 6-egg loop. Is this ever
  hit in shipping levels? The slot table is usually empty pre-
  boss, but some boss-prep rooms have a lot of ambient sprites.
- **`CODE_03D3F8` generator-guard semantics.** The `init_egg`
  body for $023/$024 calls `CODE_03D3F8` and bails (free-slot)
  if it returns EQ. The name suggests "this egg was spawned by
  a generator object (which generators?)" and the bail path
  prevents the trail from filling with cosmetic eggs. What
  routine sets the per-slot "from generator" flag the guard
  reads?
- **Egg Plant variant select bit at `$70E2,x & $10`.** The Init
  reads bit 4 of the spawn-X position to pick between regular-
  egg vs needlenose-egg variants. This means a single
  level-data X coordinate is overloaded as both "where to place
  the plant" and "which variant" -- the variant flag is encoded
  in the low byte of the X coord. Does the level editor
  recognise this, or is the variant bit silently corrupted when
  the user re-positions a placed Egg Plant?
- **`$7AF8 / $74A2` flash timing in `main_giant_egg_frog`.** The
  pre-expiry flash at `CMP #$0002 BNE` only fires when the timer
  is exactly 2; it should arguably be `CMP #$0002 BCS` (>= 2)
  for a longer flash duration. The single-frame flash is
  visually subtle. Was this a typo (`BNE` instead of `BCS`),
  or intentionally a one-frame strobe?
- **$06B's spawn-direction-from-X-delta in `init_hit_green_egg_block`.**
  The init records `Player_XPos - blockX` into `$78,x` as a
  signed direction-of-launch flag. But the Main body's use of
  this byte (in the `BIT.b $78,x` test at `CODE_05FF23`) only
  reads the sign bit. So the magnitude is unused. Was this
  retained for a planned "throws-toward-Yoshi proportional to
  miss-distance" mechanic that never shipped?
