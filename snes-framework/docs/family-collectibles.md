# YI Collectibles family reference

Standalone reference for the Yoshi's Island collectible sprite family
-- the in-level rewards Yoshi picks up to pad his coin / red-coin /
flower / star / 1-up totals, plus the Key/LockedDoor pair that
gates progression. Nine in-scope sprite IDs spread across five
banks, but the actual award helpers are concentrated in `Bank03.asm`
(four short routines that every collectible funnels through).

The collectibles family is unusual in that most of its sprite IDs
exist not because the sprites behave differently from each other,
but because they originate from different *spawn paths*. The
"item drop from broken egg" coin needs physics; the "static
floor coin" doesn't. Both are coins. So the same visual gets two
sprite IDs with very different Main routines.

This doc complements:

- `docs/spritestateengine.md` -- the 9-state engine dispatcher
  every entry here sits on top of. Note that **every collectible's
  `StompRt` and `RideYoshiRt` is a no-op RTL alias** -- collection
  is detected via the `$7D36,x` collision-marker path inside
  `Main`, never via the head-bop slot. See §10.2 Pattern E
  (latent-flag sentinel) for the Bubbled1up 3-up score-gate.
- `docs/family-misc.md §1` (Door family) -- the LockedDoor variants
  `$04E` and `$131` are the Key's gating counterparts. The Key
  writes the item-memory bit that the matching LockedDoor reads
  on next-spawn. The two doors do not directly know about each
  other; they communicate through the item-memory bitmap.
- `docs/family-cinematic.md` -- the Goal Ring (`$00D`) is the
  consumer of `!RAM_YI_Level_RedCoinsCollectedLo` and
  `!RAM_YI_Level_FlowersCollectedLo` for the post-level tally
  + bonus-game roulette. The collectible sprites here are the
  upstream writers.
- `docs/family-clouds.md` -- five Winged Cloud variants spawn
  members of this family on pop. `$00B7 WingedCloudWithBubbled1up`
  spawns the Bubbled1up. `$00B8 WingedCloudWithFlower` spawns one
  of the two Flower variants (RNG pick). `$00BD WingedCloudWithCoin`
  spawns Coin `$115`. `$00BF WingedCloudWithKey` spawns Key `$027`.
  `$00B6 WingedCloudWith8Coins` spawns eight ambient coin sparkles
  via `CODE_pop_8_coins`.
- `docs/family-eggs.md` -- the four egg flavours, when they
  collide with an enemy, drop one of: a red coin (red egg), a
  coin (yellow egg), or a coin / star pair (green giant). Those
  drops route through `CODE_make_star_or_coin` which is the
  star-or-coin smart picker documented below.

Source of truth for all addresses below: framework asm at
`yi/Banks/Bank02.asm` (Key + SuperStar + LockedDoor inits,
~3380-3470 and 2433-2666), `yi/Banks/Bank03.asm` (the four
shared award helpers `CODE_03A4A2 / CODE_03A4E9 / CODE_03A520 /
CODE_03B353`, plus the smart-picker `CODE_make_star_or_coin` and
the item-memory bitmap helpers `CODE_03D3F8 / CODE_03D3F3 /
CODE_03D406`), `yi/Banks/Bank04.asm` (Coin + Bubbled1up,
~9147-9220 and ~9252-9377), `yi/Banks/Bank0C.asm` (HealthStar +
FloatingCoin + RedCoin, ~7103-7160 and ~13559-13760), and
`yi/Banks/Bank0E.asm` (both Flower variants ~6648-7000).
Cross-verified against the Raidenthequick disassembly's
`init_coin / init_red_coin / init_star / init_super_star /
init_key / init_flower / init_flower_2 / init_bubbled_1up`
labels in the corresponding bank files.

---

## 1. Family at a glance

Nine sprites in scope. Three are coins (one with physics for
spawn-from-egg, two static floor-placed). Two are stars (the
powerup variant and the "running total" health/energy variant).
Two are flowers (rendered differently but funnel into one shared
collect routine). One is a 1-up trapped in a bubble. One is the
Key.

| Sprite ID | Constant name | Bank | Init handler | Main handler | Award route | Role |
|-----------|---------------|------|--------------|--------------|-------------|------|
| `$027` | `Key` | 02 | `$02:9FE4` `init_key` | `$02:A04A` `main_key` | `CODE_03C640` -> item-memory write at cached door tile via `CODE_03D3F3` | The Locked-Door key. Init runs `FXCODE_0ACE2F` (keyhole-tile spatial scanner); if a keyhole Map16 tile is within scan radius the key teleports to it. Caches the resolved (X,Y) into `$701900/$701902` for later use as the door's item-memory address. Main alternates between "watch for Yoshi pickup" and `CODE_03BB1D` (carried-by-Yoshi physics). On pickup plays `SoundID1E_PickUpKey`. |
| `$065` | `RedCoin` | 0C | `$0C:EA06` `init_red_coin` | `$0C:EA40` `main_red_coin` | `CODE_03B35B` (red-bypass entry) -> `INC RedCoinsCollectedLo` + sound + falls into `CODE_03A520` to also bump CoinCount | Static red coin. Init checks item-memory via `CODE_03D3F8`; if already collected, despawns immediately. Uses `!EXRAM_YI_Level_ShowHiddenItemsFlag` to pick palette: when the flag is set the coin shows in its red-coin form, when clear it disguises as a yellow coin (the "20 red coins hidden as yellow coins" gimmick). Pickup runs **both** counters: `RedCoinsCollectedLo` (max 20) AND `CurrentCoinCountLo` (the 99-coin extra-life counter). |
| `$088` | `SuperStar` | 02 | `$02:9895` `init_super_star` | `$02:98F4` `main_super_star` | direct write to `!EXRAM_YI_Player_CurrentFormLo = !Define_YI_PlayerForm10_SuperBabyMario`; arm `SuperBabyMarioTimerLo = $0200` (~10.7s @ 30 fps) | The 10-second-Super-Baby-Mario powerup. Init seeds an X-vel from `DATA_02987C` (`$FF80` or `$0080` depending on `$7400,x` low bit -- the spawn direction), draws a 3-frame star via SuperFX `FXCODE_088619`, plays `SoundID30_AppearingStars`. Main = 2-state `DATA_super_star_state_ptr`: state 0 = idle-pickup, state 1 = transform-to-Super-Baby-Mario. The transform path despawns Baby Mario sprite, writes player-form, queues music `$0002` (Super-Mario theme). |
| `$0FA` | `Flower` | 0E | `$0E:B36A` `init_flower` | `$0E:B3AC` `main_flower` | `CODE_0EB4AE` (per-flower bump) -> `INC FlowersCollectedLo` capped at 5; 5th flower also runs `CODE_03A4A2` (1-up) | SuperFX-rendered flower. Init opens petals via item-memory mark helpers `CODE_03D40E` / `CODE_03D406`. 4-state Main (`DATA_0EB3A0`): `bloom_up -> sway -> collected -> reward`. Per-frame uses `FXCODE_088205` or `FXCODE_08835F` to render the bloom (the second is the "fully open" pose). On collect plays `SoundID36_CollectFlower` (or `SoundID08_1up` if this was flower #5), spawns ambient sparkle `$01CD`, writes item-memory bit, then state 3 (`CODE_0EB525`) handles the first-flower tutorial message gate `!Define_YI_TutorialMessage_FirstFlower`. |
| `$100` | `Bubbled1up` | 04 | `$04:C89A` `init_bubbled_1up` (RTL no-op) | `$04:C89B` `main_bubbled_1up` | `CODE_03A4A2` (1-up) **or** `CODE_spawn_3up_score` (3-up) depending on `$18,x` sentinel byte | The bubble-trapped 1-up. Init is bare RTL. Main bobs the bubble via signed-comparison of `$75E2,x` against the Y-velocity (a self-reflecting wave-bob). Pickup triggered by `$7D36,x`: BMI = Yoshi collision -> 1-up; non-zero = sprite collision (egg or yoshi-bonk-from-below). The `$18,x` byte is the **3-up gate**: spawned by `CODE_pop_1up_bubbled` ($00B7 Winged-Cloud-with-bubbled-1up) which writes `$18 = $0002` only if `!RAM_YI_Level_StarCounterDigit2Lo == 3` (player has 30+ stars). With 30+ stars and a `BCC` from the bubble-bonk path, the 1-up becomes a 3-up. |
| `$110` | `Flower` (alternate) | 0E | `$0E:B54E` `init_flower_2` | `$0E:B55F` `main_flower_2` | shares `CODE_0EB525` collect handler with `$0FA` | The OAM-tilemap flower variant. Init = `CODE_03D406` (item-memory pre-mark) + `CODE_02A007` (keyhole-tile snap, same helper used by Key + LockedDoor + Flower). 4-state Main (`DATA_0EB557`): `wait_for_visible -> bloom_anim_open -> bloom_anim_loop -> collected (jmp to shared $0FA collect)`. Bloom animation walks `$7402` (tile index) `0->9 then 9->0` via `$16,x` ping-pong, taking ~72 frames vs `$0FA`'s SuperFX path which is variable-rate. Same collect path -> same flower counter. |
| `$115` | `Coin` | 04 | `$04:C968` `init_coin` | `$04:C97B` `main_coin` | `CODE_03B353` -- which **checks `$7042,x` palette bit `$0002`**: bit set -> falls through to `CODE_03B35B` red-coin path; bit clear -> calls `CODE_03A520` coin-count bump | The "spawnable" coin. Init seeds 3 timers: `$7A96 = $0100` (solid-state lifetime), `$7A98 = $0140` (fade-out lifetime), `$7AF6 = $0010` (pickup-delay grace period). Main has a `$76,x` sub-state: state 0 = idle + watch for Yoshi + animate (4-frame cycle from global `$7974`). On a head-bonk-from-below (`$7860 & 1` set with `$76 == 0`) the coin re-runs `init_coin`, picks a random X-vel via global RNG `$10`, picks an upward Y-vel, and transitions to state 1 (in-air). State 1 lets the coin arc and fade. Used by: broken-egg coin spawns, brick-bump coin drops, winged-cloud 1-coin pop, watermelon-seed coin drops. **A red-tinted instance via palette bit selects red-coin award.** |
| `$1A2` | `HealthStar` | 0C | `$0C:B530` `init_star` | `$0C:B537` `main_star` | `CODE_03A4C3` (the score-pop-without-spawn entry) + direct write `$0396 += 10` to `StarsPendingAutoIncreaseLo` | The Health/Energy Star (running-total powerup). Init sets `$7A96 = $0280` (lifetime). Main is dominated by the flash-cycle (uses `DATA_0CB4F0` 16-byte mask table indexed by `$7A96 >> 4` to pulse `$74A2` between $05 and $FF as the star ages -- the famous "ageing star" blink). On Yoshi pickup spawns AmbSpr `$01EF` "starburst", adds 10 to `StarsPendingAutoIncreaseLo`, sets `$0B7F = $0082` (probable star-tally side-effect), despawns. Has its own 2-state `$18,x` micro-machine for "in-air" vs "settled-on-floor" behavior. |
| `$1AF` | `FloatingCoin` | 0C | `$0C:E961` `init_floating_coin` | `$0C:E98B` `main_floating_coin` | `CODE_03A520` (direct coin-count bump only -- no red-coin branch) | Static floor / floating coin. Init checks item-memory via `CODE_03D3F8` and despawns if already collected. If the level header has `LevelHeaderSpritePalette == $0002` (the special "use alt coin palette" header), ORs `$7042,x |= $000E` to recolor. Main is a simple animate-and-watch loop: 4-frame animation cycle from global `$14` LSR x3, watch `$7D36,x` for Yoshi or egg collision; on collect plays `SoundID09_Coin`, increments `CurrentCoinCountLo` via `CODE_03A520`, marks item-memory via `CODE_03D3EB`, spawns AmbSpr `$01E4` sparkle, despawns. |

Notable observations from the table:

- **Nine sprite IDs collapse into FOUR award routes**: `CODE_03A4A2`
  (1-up scoring), `CODE_03A520` (coin counter, used by both yellow
  coin and red coin's fallthrough), `CODE_03B35B` (red-coin counter
  + auto-bump coin counter), and the `StarsPendingAutoIncreaseLo`
  direct-write for HealthStar. The Key + SuperStar are the two
  one-off paths (Key writes item-memory + carry-by-yoshi state;
  SuperStar rewrites the player form).
- **Every collectible has a no-op StompRt + RideYoshiRt**. Yoshi
  cannot stomp or stand on a collectible; collection is purely via
  `$7D36,x` collision marker inside Main.
- **Both Flowers funnel into one collect routine** (`CODE_0EB525`).
  The `$0FA` vs `$110` split is a *rendering* split (SuperFX bloom
  vs OAM tilemap bloom), not a behavior split.
- **Yellow coin and red coin share Main `$115`**: a placed coin
  sprite with palette bit `$7042 & $0002` set IS a red coin. The
  separate sprite `$065 RedCoin` exists only because the static
  red-coin placements need the level-load-time hidden-item logic
  + the ShowHiddenItemsFlag check, neither of which the
  spawnable-coin Main can do.

---

## 2. Coins ($065, $115, $1AF)

Three "coin"-shaped sprites with three different roles.

### 2.1 The three coin sprites compared

| Behaviour aspect | `$115` Coin | `$1AF` FloatingCoin | `$065` RedCoin |
|------------------|-------------|---------------------|----------------|
| Origin | spawned at runtime by other sprites | placed by level designer | placed by level designer |
| Item-memory check | none (transient) | yes (`CODE_03D3F8` on Init) | yes (`CODE_03D3F8` on Init) |
| Lifetime timers | `$7A96`/`$7A98`/`$7AF6` (3 timers) | none | none |
| Physics | full (X-vel, Y-vel, gravity, bounce) | none | none |
| Animation cycle | 4-frame from global `$7974` >> 3 | 4-frame from global `$14` >> 3 | 4-frame from global `$14` >> 3 |
| Bonk-from-below | yes (re-init + arc upward) | no | no |
| Pickup grace period | `$7AF6 = $0010` frames | immediate | immediate |
| Award helper | `CODE_03B353` (palette-bit-dependent) | `CODE_03A520` (always yellow) | `CODE_03B35B` (always red) |
| Counter(s) bumped | CoinCount OR (CoinCount + RedCoinCount) | CoinCount | RedCoinCount + CoinCount |
| Sound | `SoundID09_Coin` or `SoundID93_RedCoin` | `SoundID09_Coin` | `SoundID93_RedCoin` |
| Pickup sparkle | AmbSpr `$01E4` | AmbSpr `$01E4` | AmbSpr `$01E4` + AmbSpr `$0226` (palette-tinted spinning popup) |
| Variant-encoding | -- | palette via level-header byte | palette via level-header byte + ShowHiddenItemsFlag |

The pickup ambient is the same `$01E4` "coin sparkle" sprite
across all three. Red coin additionally spawns `$0226` (a
spinning palette-tinted popup) via `CODE_03A4E9` which forks
off `CODE_03A4F5` to drop the spinner before the counter-bump
fallthrough.

### 2.2 The award routine `CODE_03B353` and its red-bypass `CODE_03B35B`

Lives in `Bank03.asm` at `$03:B353`. Called by `$115 Coin` Main
on Yoshi-collect:

```
CODE_03B353:                    ; entry: regular coin (test palette)
    LDA $7042,x                 ; palette + flip bits
    BIT #$0002                  ; bit 1 = "red coin flavor"
    BEQ CODE_03B373             ; bit clear -> yellow path
CODE_03B35B:                    ; entry: always red (used by $065 RedCoin direct)
    JSL CODE_03A4E9             ; spawn AmbSpr $0226 + fall into CODE_03A520
    LDA #!Define_YI_SoundID93_RedCoin
    INC !RAM_YI_Level_RedCoinsCollectedLo
    LDY !RAM_YI_Level_RedCoinsCollectedLo
    CPY #$14                    ; capped at 20 red coins
    BMI +
    INC                         ; sound ID +1 for the "got all 20" variant
+   JSL CODE_push_sound_queue
    BRA done

CODE_03B373:                    ; entry: yellow path
    JSL CODE_03A520             ; just bump CoinCount, no sparkle
    LDA #!Define_YI_SoundID09_Coin
    JSL CODE_push_sound_queue
    BRA done
```

Two important subtleties:

1. **Red-coin pickup auto-bumps the regular coin counter too.**
   `CODE_03A4E9` falls through to `CODE_03A520`. So one red coin
   = +1 RedCoinsCollected, +1 CurrentCoinCount, two sounds (well,
   one sound; the red sound replaces the yellow because of the
   `LDA / JSL push_sound_queue` overwrite). A speedrunning corollary:
   collecting all 20 red coins gives you 20 toward the 100-coin
   extra-life counter for free.

2. **The 20th red coin plays a different sound.** `CPY #$14 / BMI`
   skips the `INC`; reaching exactly 20 (`Y=$14`) means BMI not
   taken, so `INC` runs and `SoundID93+1 = SoundID94` plays
   instead (probable "level complete fanfare" variant). This is
   the only place in the codebase where the red coin sound ID
   gets bumped.

### 2.3 `CODE_03A520` (the canonical coin-count bump)

```
CODE_03A520:
    INC !RAM_YI_Level_CurrentCoinCountLo
    LDA !RAM_YI_Level_CurrentCoinCountLo
    CMP #$0064                   ; 100
    BCC done
    JSL CODE_03A4A2              ; spawn 1-up score
    LDA #$FE40
    STA !EXRAM_YI_Level_AmbSpr_YSpeedLo,y
    STZ !RAM_YI_Level_CurrentCoinCountLo
done:
    RTL
```

At 100 coins, the counter resets and a 1-up is awarded via
`CODE_03A4A2` (which itself increments `CurrentLifeCount` and
`1upsCollectedInCurrentLevelLo`, spawns a `$01BF` score sprite,
plays `SoundID08_1up`).

Notably, the 100-coin extra life uses the **same** path as any
other 1-up award. The `$01BF` ambient sprite is the universal
"+1up" score-popup (also used by 1-up cards, bonus-game wins,
flower #5, etc.).

### 2.4 Spawnable Coin `$115` -- the bonk-from-below path

The `$115` Coin has two state-0 paths inside Main that the
others don't:

```
main_coin ($04:C97B):
    JSL CODE_03AF23              ; freeze + physics wrapper
    ; --- per-frame anim ---
    LDA $7974                    ; global anim counter
    LSR : LSR : LSR
    AND #$0003
    STA $7402,x                  ; 4-frame cycle
    LDY $76,x                    ; sub-state
    BEQ idle_or_bonk
    ; --- state 1+ (mid-arc) ---
    LDA $7860,x : LSR
    BCC anim_pulse
    JSL CODE_init_coin           ; re-seed lifetime timers on bounce
    ; pick X/Y velocity from global RNG $10
    LDA $10 : AND #$01FF : CLC : ADC #$FF80 : STA XSpeedLo,x
    LDA $10 : XBA : AND #$01FF : EOR #$FFFF : INC : CLC : ADC #$FE00 : STA YSpeedLo,x
    LDA #$0002 : STA $74A2,x
    STZ $76,x                    ; back to state 0
    RTL
idle_or_bonk:
    LDA $7860,x : LSR
    BCC check_pickup
    ; --- ground-bonk path (state 0) ---
    LDA XSpeedLo,x : CMP #$8000 : ROR : STA XSpeedLo,x   ; halve velocity
    LDA #$FD80 : STA YSpeedLo,x                          ; pop up
    LDA #$0040 : STA $7542,x                             ; reset gravity timer
check_pickup:
    LDA $7AF6,x : BNE check_lifetime    ; pickup grace still ticking
    LDY $7D36,x : BEQ check_lifetime    ; no collision
    BMI yoshi_picks_up
    ; egg collision: only $022-$02B can collect a coin
    LDA $6EFF,y : CMP #$0010 : BNE check_lifetime
    LDA $7D37,y : BEQ check_lifetime
    LDA $735F,y : CMP #$0022 : BMI check_lifetime
                  CMP #$002C : BPL check_lifetime
yoshi_picks_up:
    JSL CODE_04CA3A              ; spawn $01E4 + JSL CODE_03B353
    JML CODE_despawn_sprite_free_slot
check_lifetime:
    LDA $7A96,x : BNE pulse
    LDA $7A98,x : BNE flash_fade
    LDY $78,x : BNE yoshi_picks_up    ; "auto-collect" flag
    JML CODE_03A31E                   ; despawn (timer expired)
flash_fade:
    LDA $7974 : AND #$0001 : ASL : DEC : STA $74A2,x  ; flicker $74A2 between $FF and $01
pulse:
    RTL
```

The "pickup grace" `$7AF6` matters because the coin spawn path
is typically: an egg breaks, spawns a coin going upward; if the
grace weren't there, the same yoshi/egg collision would
immediately re-grab it as soon as it was spawned. 16 frames
prevents that.

**Smart-coin-or-star picker via `CODE_make_star_or_coin`**
(`$03:B42F`): when an egg breaks against an enemy, instead of
hard-coding "spawn a coin" or "spawn a star", the engine asks:
*does the player need stars?* If `!RAM_YI_Level_StarTimerLo <
$012C` (`!Define_YI_Level_SoftMaxStarTimerThreshold` = 300), it
spawns a `$1A2` HealthStar instead of a `$115` Coin. The
threshold acts as a "stars-are-full" signal -- when you're
topped up, eggs drop coins; when you're losing health, eggs
drop stars. The picker is used by green/yellow eggs and by the
green giant egg's hit-handler.

---

## 3. Flowers ($0FA, $110)

Two flowers with **identical pickup semantics** but **different
rendering paths**. Both share the same Main state $03 collect
routine `CODE_0EB525`.

### 3.1 `$0FA` (SuperFX-rendered)

```
init_flower ($0E:B36A):
    ; pre-condition: if 701900/701902 already non-zero, restore from cache
    LDA $701900,x : BNE has_cache
    CMP $701902,x : BEQ no_cache
has_cache:
    STA $04 : LDA $701902,x
    JSL CODE_03D40E              ; mark item-memory bit (alternate entry)
    BRA setup_render
no_cache:
    JSL CODE_03D406              ; mark item-memory bit (standard entry)
setup_render:
    LDA $7722,x : BPL has_dyntile
    JSL CODE_03AE60              ; allocate dyntile slot
    LDA #$0100 : STA $7A36,x      ; R6 multiplier seed
    JSR CODE_0EB3CF               ; render the SuperFX bloom
    BRA done
has_dyntile:
    JSL CODE_03AA52               ; resync sprite list
done:
    JSL CODE_02A007              ; keyhole-tile snap (same helper Key uses)
    RTL
```

The state machine:

```
DATA_0EB3A0 = DATA_flower_state_ptr_fa:
    dw CODE_0EB41A    ; state 0: prep state-1, set $16=4 (sway range)
    dw CODE_0EB42A    ; state 1: bloom up (R5/R6 PLOT values rise to target)
    dw CODE_0EB457    ; state 2: sway loop + check Yoshi collision
    dw CODE_0EB525    ; state 3: collected (shared with $110)
```

State 1 uses two 2-entry tables `DATA_0EB422 = {$0100, $0150}`
and `DATA_0EB426 = {$0100, $00B0}` indexed by `$16,x` to pick
bloom-target / sway-amplitude pairs. The bloom takes ~16 frames
before transitioning to state 2.

State 2's `CODE_0EB479` is the collision-check entry that's
shared with `$110`. It reads `$7D36,x` and, on Yoshi-touch,
falls into `CODE_0EB4AE` (the actual collect handler):

```
CODE_0EB4AE:                     ; the flower collect
    LDA #$0020 : STA $7AF6,x     ; "wait 32 frames before despawn"
    LDA #$00FF : STA $74A2,x     ; full-bright flash
    INC $76,x                    ; -> state 3
    INC !RAM_YI_Level_FlowersCollectedLo
    LDY !RAM_YI_Level_FlowersCollectedLo
    CPY #$05 : BCC normal_flower
    ; -- 5th flower bonus path --
    LDY #$05 : STY !RAM_YI_Level_FlowersCollectedLo   ; clamp
    ; compute (X-8, Y-8) for score popup
    LDA $7CD6,x : SEC : SBC #$0008 : STA $0000
    LDA $7CD8,x : SEC : SBC #$0008 : STA $0002
    JSL CODE_03A4A2              ; spawn +1up score
    LDA #!Define_YI_SoundID08_1up
    BRA queue_sound
normal_flower:
    LDA #!Define_YI_SoundID36_CollectFlower
queue_sound:
    JSL CODE_push_sound_queue
    LDA #!Define_YI_AmbSpr1CD     ; the "multi-frame puff" sparkle
    JSL CODE_spawn_ambient_sprite
    ; ... seed puff position + timer at the spawned slot ...
    LDA $701900,x : BNE has_cache
    CMP $701902,x : BEQ no_cache
has_cache:
    STA $04 : LDA $701902,x
    JML CODE_03D3F3               ; set item-memory bit at cached pos
no_cache:
    JML CODE_03D3EB               ; set item-memory bit at sprite pos
```

So the 5th flower in a level **automatically gives a 1-up** in
addition to its normal counter bump (capped at 5 -- collecting
a 6th does nothing). The flower count is also a level-completion
metric that the Goal Ring reads at level end for the bonus-game
roulette duration (see `docs/family-cinematic.md` §5).

State 3 (`CODE_0EB525`):

```
CODE_0EB525:
    LDA $7AF6,x : BNE wait        ; 32-frame collect grace from $0020 above
    LDA !RAM_YI_Level_TutorialMessageFlagsLo
    AND #!Define_YI_TutorialMessage_FirstFlower
    ORA !RAM_YI_Level_CurrentLevelFromMapLo
    BNE despawn                   ; not first ever flower / not in MakeEggsThrowEggs
    LDA !RAM_YI_Level_TutorialMessageFlagsLo
    ORA #!Define_YI_TutorialMessage_FirstFlower
    STA !RAM_YI_Level_TutorialMessageFlagsLo
    LDA #$002D
    STA $704070                   ; tutorial message ID
    INC !RAM_YI_Level_MessageBoxState
despawn:
    JSL CODE_despawn_sprite_free_slot
wait:
    RTS
```

The "MakeEggsThrowEggs"-level check is interesting:
collection in **the introductory tutorial level only** triggers
the "you collected a flower!" tutorial message box. Subsequent
levels still bump the counter but skip the message.

### 3.2 `$110` (OAM-tilemap-rendered)

Same Init pattern as `$0FA` but simpler: `CODE_03D406` then
`CODE_02A007`. No dyntile, no SuperFX bloom.

```
DATA_0EB557 = DATA_flower_state_ptr_110:
    dw CODE_0EB56C    ; state 0: wait until on-screen
    dw CODE_0EB586    ; state 1: 4-frame OAM bloom anim
    dw CODE_0EB5A5    ; state 2: 10-frame "sway" walking $7402 0->9->0
    dw CODE_0EB525    ; state 3: collected (SHARED WITH $0FA)
```

State 0 (`CODE_0EB56C`) checks `$7680,x` / `$7682,x` (screen-position
deltas) -- only advances to state 1 when fully inside the visible
area. So `$110` flowers stay invisible until on-screen.

State 1 (`CODE_0EB586`) walks `$7402` `0->1->2->3` (4 frames of
2-frame holds) then transitions.

State 2 (`CODE_0EB5A5`) ping-pongs `$7402` between `0` and `9`
using `$16,x` as the toggle target. The walk is 4-frame holds
between increments, taking ~36 frames per direction.

State 3 is `CODE_0EB525` -- byte-for-byte the same as `$0FA`'s
state 3.

### 3.3 Why two Flower sprites?

The winged-cloud-with-flower pop helper picks ONE OR THE OTHER
at random:

```
CODE_pop_flower ($03:C681):
    SEP #$10
    LDX $12
    JSL CODE_despawn_sprite_clear_graphics
    LDY #$71
    JSL CODE_03C878              ; RNG probe (carry-out random)
    LDA #!Define_YI_NorSpr110_Flower
    BCC use_110
    LDA #!Define_YI_NorSpr0FA_Flower
use_110:
    TXY
    JSL CODE_spawn_sprite
    LDA #$0002
    STA !EXRAM_YI_Level_NorSpr_CurrentStatus,x
    RTL
```

So **a popped cloud flower is 50/50 which variant you get**.
Visually they're nearly identical post-bloom (the differences
are in the bloom *animation*, not the final pose); behaviorally
they're identical from the player's perspective.

The likely reason this exists is dyntile / OAM budget: `$0FA`
requires a dyntile + SuperFX cycle each frame; `$110` is OAM
only. In some level configurations the dyntile slot might be
unavailable, so the engine alternates. The randomization is
also why level-placed flowers always default to `$0FA`
(designer's pick) but cloud flowers can be either.

---

## 4. Stars ($088, $1A2)

Two stars with **completely different roles**:

### 4.1 `$088` SuperStar (10-second powerup)

The Super Star is the rare "drop everything and become
Super-Baby-Mario" powerup. Init draws a 3-frame star via
`FXCODE_088619`, plays `SoundID30_AppearingStars`, gives the
star an X-velocity from a 2-entry table `DATA_02987C =
{$FF80, $0080}` indexed by `$7400,x` low bit (so it always
either drifts left or drifts right -- never stationary).

State 0 (`CODE_super_star_state_00_idle_pickup` at `$02:9900`):

```
    JSL CODE_03AA2E             ; full physics
    JSL CODE_03AF23             ; freeze + draw
    LDA $7542,x : BNE check_yoshi
    ; --- $7542 = 0 (gravity-disable timer expired) ---
    LDA !EXRAM_YI_Player_CurrentFormLo
    CMP #!Define_YI_PlayerForm10_SuperBabyMario
    BEQ check_yoshi             ; already super -- skip re-init
    JSL CODE_0298E8             ; replay $30 sound + redraw
    JMP CODE_029888             ; reset visual + state-byte
check_yoshi:
    ; check (yoshi-distance, baby-mario presence, ammo-in-mouth)
    JSL CODE_029BCA
    LDY $7D36,x : BPL drift
    LDA $7680,x : CLC : ADC #$0020 : CMP #$0120 : BCS drift  ; X too far
    LDA $7682,x : CLC : ADC #$0020 : CMP #$0100 : BCS drift  ; Y too far
    LDA !EXRAM_YI_Player_CurrentFormLo
    BNE consume_already_super     ; already super -> just sound + despawn
    ; --- not super, check that Baby Mario is on Yoshi ---
    LDA $61B2 : BPL drift         ; bowser-arena flag
    LDA $6150 : BEQ start_transform
    LDA $6162 : BEQ start_transform
    LDA !EXRAM_YI_Level_Player_AmmoTypeInMouthLo
    CMP #$0001 : BEQ drift        ; mouth currently has X type ammo
    CMP #$0004 : BEQ drift
start_transform:
    INC $701978,x                 ; sub-state byte ($18 alias) -> state 1
    LDA #$00FF : STA $74A2,x       ; full bright
    LDA $7040,x : AND #$FFF3 : STA $7040,x
    LDA #$0020 : STA $7A96,x       ; 32-frame transform pre-delay
    STA !EXRAM_YI_Level_FreezeYoshiFlagLo
    STA !EXRAM_YI_Level_FreezeSpritesFlagLo
    RTL
consume_already_super:
    LDA #!Define_YI_SoundID27_CollectSuperStar
    JSL CODE_push_sound_queue
    JSL CODE_03A31E               ; despawn
    JMP refresh_super_timer       ; reset timer to $0200 anyway
drift:
    LDA $7860,x : AND #$0001 : BEQ done
    LDA #$FD00 : STA YSpeedLo,x   ; bounce when grounded
done:
    RTL
```

So a Super Star only triggers a transform if (a) Yoshi is in
range; (b) Yoshi is not already Super Baby Mario; (c) Baby
Mario is currently carried (the `$6150 / $6162` checks);
(d) the mouth isn't full of type-1 (egg) or type-4 (watermelon
seed?) ammo. Failing any condition just plays the
`SoundID27_CollectSuperStar` and refreshes the timer (line
3.5.1 below).

State 1 (`CODE_super_star_state_01_transform_to_super_baby_mario`
at `$02:99F`):

The 32-frame pre-delay `$7A96` counts down. When it hits 16,
the powerup sound `SoundID05_Powerup` plays and a `$01E7`
sprite spawns at `($7CD6, $7CD8)` -- the "transformation burst"
ambient. When `$7A96` hits zero:

```
    LDA #$2000 : STA $61B2          ; bowser-arena flag toggle
    LDA #$FFFF : STA $7E48          ; clear sprite-page render mask
    JSL CODE_04F74A                 ; player palette setup
    LDA #!Define_YI_PlayerForm10_SuperBabyMario
    STA !EXRAM_YI_Player_CurrentFormLo
    LDA #$0010 : TSB $7E08          ; set bit 4 of player-state flags
    LDA #$0116 : STA $60BE          ; player anim frame
    LDA #$0008 : STA $60C0          ; player anim sub-frame
    LDA #$FC00 : STA $60AA          ; player Y-velocity (hop)
    LDA $60C4 : EOR #$0002 : STA $60C4 : STA $7400  ; flip facing
    LDA DATA_02999B,y : STA $60B4   ; X-velocity ($0100 right / $FF00 left)
    STZ $60D2 / STZ $61DC
    JSL CODE_04EF27                 ; player camera reset
    JSL CODE_03A31E                 ; despawn the star
    LDA #$0029 / LDY #$00 / JSL CODE_spawn_sprite     ; spawn Baby Mario sprite slot
    LDA #$0010 / STA !EXRAM_YI_Level_NorSpr_CurrentStatus
    LDA $7182 / SBC #$0008 / STA $7182
    JSL CODE_03BEB9                 ; resync sprite ptr table
    LDA #FXDATA_520000+$B600 / STA $6114    ; SuperFX program seed
    STZ FreezeYoshi / STZ FreezeSprites
    LDA #$0002 / STA !RAM_YI_Global_PlayMusicLo     ; music ID $0002 (Super-Mario theme)
    STZ $0205                       ; clear pause-related
refresh_super_timer:
    LDA #$0200 : STA !EXRAM_YI_Player_SuperBabyMarioTimerLo
    RTL
```

`$0200` = 512 frames = ~8.5s at 60fps. After this expires the
player form drops back to default.

The transform sequence is therefore: freeze world (32 frames)
-> bright flash -> sound -> burst FX -> instant player-form
swap + Baby Mario sprite reset + music change. The Super Star
sprite itself is despawned during this sequence; the
SuperBabyMarioTimerLo is the only persistent state.

### 4.2 `$1A2` HealthStar (running-total powerup)

The Health/Energy Star is the much more common "+10 to your
Stars meter" pickup. Init seeds `$7A96 = $0280` (640-frame
lifetime).

The Main routine has two distinct halves:

**Half 1: bobs + ages**

```
main_star ($0C:B537):
    LDA FreezeSprites
    ORA !RAM_YI_Level_TouchedFuzzyMosaicTimerLo
    ORA !RAM_YI_Level_ItemBeingUsed
    BNE done                      ; gate
    LDA $7AF6,x : BNE flash_anim  ; pickup grace
    LDY $7D36,x : BPL flash_anim  ; check Yoshi collision (BMI = player)
    ; --- pickup path ---
    LDA #!Define_YI_AmbSpr1EF      ; "starburst" -- reused from BVZ trail
    JSL CODE_spawn_ambient_sprite
    LDA $70E2,x : CLC : ADC #$0008 : STA $70A2,y
    LDA $7182,x : CLC : ADC #$0008 : STA $7142,y
    LDA #$0004 : STA $73C2,y
    LDA #$0002 : STA $7782,y
    ; --- award path ---
    LDA $70E2,x : STA $0000
    LDA $7182,x : STA $0002
    LDA #$0003 : STA $0004
    JSL CODE_03A4C3               ; score-pop ambient spawn (3-star variant)
    LDA $0396 : CLC : ADC #$000A : STA $0396   ; StarsPendingAutoIncreaseLo += 10
    LDA #$0082 : STA $0B7F        ; secondary side-effect (star-tally toggle)
    JML CODE_despawn_sprite_free_slot
```

So a HealthStar collection adds **10** to the
`StarsPendingAutoIncreaseLo` counter -- which is the
"slowly trickle up" star counter that the engine drains 1 star
per frame as a visual count-up. The "energy" name comes from
this: it's not an instant +10, it's "queue 10 stars to be added
over the next 10 'tick' increments".

The `AmbSpr $01EF` here is normally the Baron Von Zeppelin
trail-particle; the engine reuses it as a "starburst" pickup
sparkle for this single sprite (and one Tap-Tap fade-out elsewhere
-- see `docs/family-taptaps.md`).

**Half 2: ageing fade-flash**

When NOT yet picked up, the rest of Main runs the famous
"ageing star blink":

```
flash_anim:
    LDA $7A96,x : BNE compute_pulse
    JML CODE_03A31E              ; lifetime expired, despawn
compute_pulse:
    LSR : LSR : LSR : LSR        ; A = $7A96 >> 4
    TAY
    LDX #$05                     ; palette pulse value: dim
    LDA $14                      ; global timer
    AND DATA_0CB4F0,y            ; mask -- ramps faster as star ages
    BEQ stay_dim
    LDX #$FF                     ; palette pulse value: bright
stay_dim:
    TXA / LDX $12
    STA $74A2,x                  ; commit palette pulse
    ; ... continue with in-air physics or settled-on-floor handling ...
```

`DATA_0CB4F0` is a 16-byte (well, 64-byte ramp) table of bit
masks. As `$7A96 >> 4` decreases (star aging), the mask
narrows, making the flash window shorter; the star starts
slowly blinking but ends frantically blinking just before
despawn. This is what tells the player "grab this NOW".

The 2-state `$18,x` sub-machine (state 0 = in-air with
gravity / 4-band Y-vel-keyed `$7402` anim; state 1 = on-floor
with a small re-hop via `$7400,x` + `DATA_0CB4EC = {$FF80, $0080}`)
governs how the star moves while not yet picked up. State
transitions on first ground touch (`$7860 & 0x0001`).

### 4.3 Why two Stars?

| | `$088` SuperStar | `$1A2` HealthStar |
|---|---|---|
| Effect | rewrite player form for 10s | +10 to running stars counter |
| Trigger requirements | Baby Mario must be carried + mouth not full + Yoshi adjacent | just Yoshi-touch |
| Source | placed by level (also $004 hit-block, $059 continuous spawner) | dropped by eggs via `CODE_make_star_or_coin` when stars are low; placed by level (rare) |
| Sound on pickup | `SoundID30_AppearingStars` (on spawn) + `SoundID27_CollectSuperStar` (on consume) or `SoundID05_Powerup` (on transform) | none -- written silently to counter |
| Visual on pickup | full screen freeze, FX burst, music change | a +N score-popup ambient |

So they're not at all interchangeable. SuperStar = single-use
"power moment"; HealthStar = "you took damage, here's some
health back". Different sprite IDs, different banks, different
Main bodies, different award routines, different sounds.

---

## 5. Bubbled 1-up ($100)

The bobbing-bubble 1-up trapped inside a transparent sphere.

### 5.1 Init = bare RTL

```
init_bubbled_1up ($04:C89A):
    RTL
```

Yes, that's it. The Init is a no-op. All setup is done by the
spawner -- typically `CODE_pop_1up_bubbled` in `Bank03.asm`.

### 5.2 Spawner sets the 3-up sentinel

```
CODE_pop_1up_bubbled ($03:C654):
    SEP #$10
    LDX $12
    JSL CODE_despawn_sprite_clear_graphics
    LDA #!Define_YI_NorSpr100_Bubbled1up
    TXY
    JSL CODE_spawn_sprite
    LDA $701900,x : STA $7019D8,x         ; preserve cached X
    LDA $701902,x : STA $7A36,x            ; preserve cached Y as anim state
    LDA #$0002
    LDY $03A3                              ; StarCounterDigit2Lo
    CPY #$03 : BEQ store_3up_flag         ; 30+ stars -> 3-up
    LDA #$0000                            ; <30 stars -> normal 1-up
store_3up_flag:
    STA $701978,x                         ; alias of $18,x
    RTL
```

The key insight: `$701978,x` is the SRAM (`$70:7978+X`) alias
of the sprite's direct-page byte `$18,x` (DP=$7960, so
`$18+X` = `$7978+X` = `$00:7978+X` which is LoROM-mirrored to
`$70:7978+X`). Writing one writes the other.

`$03A3` is the **tens digit** of the on-screen star counter.
If the player has 30 or more stars (digit 2 == 3 or higher),
the bubble is "primed" with `$18 = $0002` -- which the Main
reads to switch the 1-up to a 3-up.

This is unique among Yoshi's Island rewards: **a powerup that
scales based on your current resources** at the time it spawns.

### 5.3 Main bob + pop

```
main_bubbled_1up ($04:C89B):
    STZ $7400,x
    LDY $18,x                        ; reload sub-state
    BEQ skip_indirect
    LDA $7362,x : BMI skip_indirect
    REP #$10
    TAY
    LDA $6024,y : AND #$FF00 : ORA #$004A : STA $6024,y   ; sub-state-based tile override
    SEP #$10
skip_indirect:
    JSL CODE_03AF23                   ; freeze + draw
    LDY $76,x : BNE check_collision
    INC $76,x                         ; first frame: advance to state 1
    RTL
check_collision:
    LDY $7D36,x
    BMI yoshi_picks_up
    BEQ bob
    ; --- sprite collision (egg or bonk) ---
    LDA $6EFF,y : CMP #$0010 : BNE bob   ; collided slot must be active
    LDA $7D37,y : BEQ bob                ; collided slot must be visible
    DEY : TYX                            ; swap to colliding slot
    JSL CODE_03B25B                      ; run the generic egg-hit handler
yoshi_picks_up:
    ; compute score popup position (X-8, Y-8)
    LDA $7CD6,x : SEC : SBC #$0008 : STA $0000
    LDA $7CD8,x : SEC : SBC #$0008 : STA $0002
    LDY $18,x : BNE three_up
    JSL CODE_03A4A2                      ; 1-up
    BRA spawn_sparkle
three_up:
    JSL CODE_spawn_3up_score             ; 3-up
spawn_sparkle:
    LDA #!Define_YI_AmbSpr1E4 : JSL CODE_spawn_ambient_sprite
    LDA $70E2,x : STA $70A2,y
    LDA $7182,x : STA $7142,y
    LDA #$000C : STA $73C2,y
    LDA #$0008 : STA $7782,y
    LDA $78,x : STA $04
    LDA $7A36,x : JSL CODE_03D3F3        ; mark item-memory
    JML CODE_despawn_sprite_free_slot
bob:
    ; --- bob physics (self-reflecting Y-velocity) ---
    LDA $75E2,x : SEC : SBC YSpeedLo,x : CLC : ADC #$0002
    CMP #$0004 : BCS not_at_apex
    LDA $75E2,x : EOR #$FFFF : INC : STA $75E2,x      ; flip vel sign
not_at_apex:
    LDA $7A98,x : BNE skip_anim
    LDA #$0008 : STA $7A98,x
    LDA $7402,x : INC : AND #$0003 : STA $7402,x      ; 4-frame anim
skip_anim:
    LDA $7860,x : AND #$0001 : BEQ done
    STZ YSpeedLo,x                       ; ground-touch zeros Y-vel
done:
    RTL
```

So the bubble has **no physics state machine** -- it just
self-reflects its Y-velocity in `$75E2` when the velocity
magnitude drops to near-zero, creating a smooth bob. Cycle: pop
up to apex -> velocity nears zero -> velocity sign flip ->
fall to floor -> ground bit zeros velocity -> next frame
self-reflect again.

The "pop" on egg/sprite hit routes through `CODE_03B25B`,
which is the generic egg-hits-sprite handler. After it
returns (it sets up the visual hit response on the colliding
egg slot), the code re-enters at `yoshi_picks_up` and awards
the 1-up or 3-up.

---

## 6. Key ($027)

The Locked-Door key. The most interesting sprite in the family
because it does **spatial pairing with a Locked Door** through
shared use of an item-memory bitmap address.

### 6.1 Key Init scans for keyhole tile

```
init_key ($02:9FE4):
    LDA $701900,x
    ORA $701902,x
    BNE done                      ; already initialized (cached pos)
    JSL CODE_03D3F8               ; check item-memory bit
    BEQ check_keyhole             ; not yet collected
    JML CODE_despawn_sprite_free_slot  ; already collected -- vanish
check_keyhole:
    JSL CODE_02A007               ; SuperFX keyhole-tile scan (shared with Flower, Doors)
    LDA $70E2,x : STA $701900,x   ; cache resolved X position
    LDA $7182,x : STA $701902,x   ; cache resolved Y position
done:
    RTL
```

`CODE_02A007` is the **keyhole-tile spatial locator** (used by
$0FA Flower, $110 Flower, $027 Key, and the entire Door family
in `Bank02.asm`):

```
CODE_02A007 ($02:A007):
    ; align sprite position to tile center (Y &= $FFF0 | $0008)
    LDA $70E2,x : AND #$FFF0 : ORA #$0008 : STA REGISTER_SuperFX_R8
    LDA $7182,x : AND #$FFF0 : ORA #$0008 : STA REGISTER_SuperFX_R0
    LDX #FXCODE_0ACE2F>>16
    LDA #FXCODE_0ACE2F
    JSL !RAM_YI_Global_RT_00DE91   ; run the SuperFX scan
    LDX $12
    LDA REGISTER_SuperFX_R7 : AND #$F800 : CMP #$B800
    BNE no_keyhole_found
    ; --- found a keyhole tile within scan radius ---
    LDA #$0002 : STA !EXRAM_YI_Level_NorSpr_CurrentStatus,x
    LDA $6000 : STA $70E2,x        ; teleport to keyhole tile X
    LDA $6002 : STA $7182,x        ; teleport to keyhole tile Y
    PLA / PLY                      ; eat caller's return frame (unusual!)
no_keyhole_found:
    RTL
```

The `FXCODE_0ACE2F` SuperFX routine scans outward from
(`R8`, `R0`) looking for a keyhole tile (Map16 ID with top
5 bits == `$B8` -- i.e., the keyhole-tile range). It returns
the resolved tile coordinates in `R7` / `$6000` / `$6002`.

The bizarre `PLA/PLY` (eat caller's return frame) only fires
when the keyhole IS found -- it changes the call's effective
return target to the caller's caller. This is how a single
JSL call ends up doing "check tile + maybe teleport + maybe
pop one stack frame".

So:
- Key Init runs `CODE_02A007`.
- If a keyhole tile is found within scan radius, key teleports
  to the keyhole tile center; status -> $0002 ("special"); the
  call stack is popped once (so we return to the parent of
  `init_key`, skipping the normal RTL from `init_key`).
- Either way the cached position becomes the (possibly-resolved)
  position. If keyhole found, cached position = keyhole tile.
  If not, cached position = original spawn.

### 6.2 Locked Door Init reads the same item-memory bit

```
init_locked_door ($02:A0BC, sprite $04E):
    JSL CODE_03D3F8                ; check item-memory: Z=1 if NOT yet collected
    BEQ init_locked_door_2          ; not collected -> stay locked
    ; --- key has been collected: morph into ClosedDoor ---
    LDA #!Define_YI_NorSpr001_ClosedDoor
    STA !EXRAM_YI_Level_NorSpr_SpriteID,x
    LDA $7182,x : CLC : ADC #$0010 : STA $7182,x  ; shift door down 16px
    BRA YI_NorSpr001_ClosedDoor_Init               ; tail into ClosedDoor init
```

`CODE_03D3F8` reads bit from item-memory bitmap at index
computed from the **sprite's tile-aligned X/Y position**. So
the key writing-to-item-memory at its cached door coordinates
is what flips the door's bit.

But here's the crucial detail: the key writes the bitmap bit
at its **own** post-keyhole-snap position. So as long as the
key was correctly placed adjacent to a keyhole tile, the key's
cached position becomes the keyhole tile position. The locked
door at that same tile (the level designer's responsibility)
queries the same bitmap entry and discovers "yes, key was
collected". The door then visually morphs into a ClosedDoor
($001) -- which is a door Yoshi can walk through.

### 6.3 Key Main = "carried by Yoshi" 2-state machine

```
main_key ($02:A04A):
    LDA $7D38,x : BEQ skip       ; sprite-collision-with-something
    LDA $18,x : CMP #$0002 : BCC skip
    STZ $7D38,x                  ; clear if state >= $02
skip:
    JSL CODE_03B9DD              ; physics + gravity + carry mechanics
    LDA $78,x : BEQ idle         ; $78 = carry-direction byte (0 = idle, nonzero = carried)
    JMP carried
idle:
    LDA $7860,x : AND #$0001 : BEQ skip_landing
    JSL CODE_03A58B              ; (landing FX)
skip_landing:
    LDY $7D36,x : BPL not_yoshi
    LDA !EXRAM_YI_Player_CurrentFormLo : BNE not_yoshi   ; in super form, skip
    JSL CODE_03C640              ; write item-memory bit at cached door position
    JSL CODE_03BEB9              ; some level-state hook
    DEC !RAM_YI_Global_SoundQueueSizeLo   ; clear pending sound (cosmetic)
    LDA #!Define_YI_SoundID1E_PickUpKey
    JML CODE_push_sound_queue
not_yoshi:
    LDA $7182,x : CMP #$0800 : BMI done   ; off-screen-Y check
    JML CODE_03A31E
done:
    RTL
carried:
    JSL CODE_03BB1D              ; carried-by-Yoshi state machine
    RTL
```

The key pickup at `JSL CODE_03C640` is the moment the door's
bitmap bit gets set:

```
CODE_03C640 ($03:C640):
    LDA $701900,x : STA $04       ; cached X
    LDA $701902,x                 ; cached Y in A
    JML CODE_03D3F3               ; mark item-memory bit at (X, Y)
```

So picking up the key writes the bitmap entry at the door's
position -- because the key had cached the door's position
into `$701900/$701902` during its Init's keyhole scan. If the
key never found a keyhole (i.e., the level designer placed it
in a non-keyhole tile), `$701900/$701902` instead hold the
key's **own** spawn position, and the key's collection only
affects an item-memory bit at that position -- which no door
will be reading. Effectively a "dead key" that the player can
collect but which doesn't unlock anything.

### 6.4 The $14 KeyFromBoss is a different beast

Note `$014 KeyFromBoss` (giant key dropped after fortress boss
dies, Init Bank02:10019) is documented in
`docs/family-kamek.md`. It's the cinematic "boss arena -> world
map" key, not the in-level Locked-Door key. Different Init,
different Main, different visual scale, different role. Don't
confuse.

---

## 7. Shared infrastructure

### 7.1 The four award helpers in Bank03

All collection paths funnel through one of these four routines
(plus the Key/Super-Star one-off paths):

| Routine | Address | Purpose |
|---------|---------|---------|
| `CODE_03A4A2` | `$03:A4A2` | Spawn ambient $01BF +1up score sprite + INC CurrentLifeCount + INC 1upsCollectedInCurrentLevel + queue SoundID08_1up |
| `CODE_03A4C3` | `$03:A4C3` | Same as 03A4A2 but skip the life/1-up bookkeeping. Used by HealthStar (which manages stars separately). |
| `CODE_03A4E9` | `$03:A4E9` | Spawn ambient $0226 (palette-tinted spinning coin popup) at sprite position **then fall through to CODE_03A520** |
| `CODE_03A520` | `$03:A520` | INC CurrentCoinCountLo; if >= 100, fall into 03A4A2 + reset coin counter |

The `CODE_03A4E9 -> CODE_03A520` fallthrough is the red-coin
path: the entry sets up the palette tint via $0006 then drops
into the regular coin-counter bump. So a red coin awards a
yellow coin's worth of counter-bump PLUS the red-coin counter
PLUS the spinning popup PLUS the red sound.

The Super-Star and the Key have their own bespoke award paths
(Super-Star directly writes player form + spawns Baby Mario;
Key directly writes item-memory bit + plays sound). Both bypass
this shared infrastructure entirely.

### 7.2 Yoshi-collision pattern (collectibles only)

Every collectible in this family uses **the same Yoshi-collision
pattern** in Main:

```
LDY $7D36,x         ; collision marker (Yoshi or other sprite)
BMI yoshi_path      ; sign bit = Yoshi (player slot is the "sprite slot" with sign bit set)
BEQ no_collision
; -- else: sprite-vs-sprite collision (typically egg, occasionally watermelon seed)
```

For `$115` Coin, the egg-collision path additionally checks
the colliding-sprite's ID is in `$0022..$002B` (the eggs).
Other collectibles trust any colliding sprite (mainly so the
green-egg-arc and shy-guy-walks-into-it edge cases work).

The `BMI yoshi_path` branch is the load-bearing piece. Yoshi
collisions stamp the player slot ID with the sign bit set;
sprite collisions stamp the slot ID without it. This is
documented in `docs/spritestateengine.md` §3.5 (`$7D36,x`
collision-marker semantics).

### 7.3 Sound IDs used

| Sound | ID | Context |
|-------|-----|---------|
| `SoundID09_Coin` | `$09` | Yellow coin pickup ($115 yellow path, $1AF FloatingCoin) |
| `SoundID93_RedCoin` | `$93` | Red coin pickup ($115 red-flagged path, $065 RedCoin) |
| `SoundID94_RedCoinFinale` (implicit) | `$94` | 20th red coin -- `INC SoundID93` to $94 |
| `SoundID1E_PickUpKey` | `$1E` | Key picked up by Yoshi |
| `SoundID30_AppearingStars` | `$30` | Super Star spawn (Init time) |
| `SoundID27_CollectSuperStar` | `$27` | Super Star consumed while already in Super Baby Mario form (no transform) |
| `SoundID05_Powerup` | `$05` | Super Star transform sequence midway flash |
| `SoundID36_CollectFlower` | `$36` | Flower #1-4 of a level |
| `SoundID08_1up` | `$08` | Any 1-up (100 coins, 5th flower, Bubbled1up, life bonus) |

The HealthStar pickup is **silent** -- the engine relies on the
`StarsPendingAutoIncreaseLo` slow-trickle to play sound
elsewhere as the counter ticks up.

### 7.4 Ambient sprite spawns

| Ambient | ID | Spawned by |
|---------|-----|------------|
| `AmbSpr1BF` | `$1BF` | `CODE_03A4A2` / `CODE_03A4C3` -- the score-popup number |
| `AmbSpr1CD` | `$1CD` | Flower collect; "medium puff" 11-stage animation |
| `AmbSpr1E4` | `$1E4` | Coin / Bubbled1up / Key pickup sparkle (universal) |
| `AmbSpr1EF` | `$1EF` | HealthStar starburst (reused from BVZ trail-particle) |
| `AmbSpr0226` | `$226` | Red coin spinning-coin popup (palette-tinted via $0006) |
| `AmbSpr1E7` | `$1E7` | Super Star transform-burst (mid-state-1 visual) |

See `yi/Constants/AmbientSpriteIDs.asm` for the full per-ambient
behavior catalogue.

### 7.5 Item-memory bitmap interaction

The Key, both Flowers, and both static coins ($065, $1AF) all
participate in the item-memory bitmap. The helpers:

| Helper | Behavior |
|--------|----------|
| `CODE_03D3F8` | **Read** bit (Y=$02; returns Z=1 if NOT collected, Z=0 if collected). Caller: Init check on first spawn. |
| `CODE_03D3EB` | **Write** bit at sprite's current position. |
| `CODE_03D3F3` | **Write** bit at supplied ($04, A) position. Used when collecting a sprite that uses a remote address (e.g., key writing the door's bitmap). |
| `CODE_03D406` | **Set & open** -- mark "I have been opened" at this position (for flower petals; same address as full collection mark, but uses Y=$00 to flag "open" rather than "collected"). |
| `CODE_03D40E` | Alternate entry to `CODE_03D406` with caller-supplied X (rather than $70E2,x). |

The bitmap layout (see `Bank03.asm:11200+`) packs:
- `(Y_pos & $0700) >> 4` selects an 8-byte row offset
- `Y_pos & $00F0` then `X_pos & $00F0` jointly produce the
  in-row bit offset
- `!RAM_YI_Level_LevelHeaderItemMemorySettingLo` selects one of
  4 64-byte pages (`DATA_03D3C3` base table) per level
- Each level has 4 pages of 512 bits each = 2048 unique
  collectible-tile positions (more than enough for a level)

So **any two collectibles in the same tile cell will share an
item-memory bit**. Levels avoid this by tile-spacing, except
intentionally (the Key / LockedDoor pair which is the WHOLE
POINT of sharing).

---

## 8. Variant encoding

Following the taxonomy in `docs/spritestateengine.md` §10.2:

### Pattern B (per-ID CMP-and-branch)

- `CODE_03B353` (the universal coin-or-red-coin awarder) tests
  the palette bit `$7042 & $0002` to fork yellow-vs-red, even
  though the bit isn't an "ID". This is Pattern B's spiritual
  cousin -- "branch on a flag the placer set" rather than "branch
  on sprite ID".

### Pattern D (fall-through Init)

- `CODE_03A4E9 -> CODE_03A520`: the red-coin entry falls
  through into the coin-counter bump. This is the cleanest
  fall-through in the family -- no `BRA` to a join point;
  literally one routine flows into the next via code adjacency.
- `CODE_super_star_state_00 -> CODE_super_star_state_01`: the
  Super Star's state-0 idle-pickup routine writes `INC $18,x`
  (advancing to state 1) and returns. The next frame's Main
  dispatch jumps into state-1.

### Pattern E (latent flag sentinel)

- **Bubbled1up `$18,x` 3-up gate**: the spawner
  (`CODE_pop_1up_bubbled`) writes `$18 = $0002` only if the
  player has 30+ stars at spawn time. The sprite's Main reads
  this 32 frames later and picks the 1-up vs 3-up path. The
  bubble's sprite ID is `$0100` regardless; the flag is the
  variant.
- **Red Coin `!EXRAM_YI_Level_ShowHiddenItemsFlag` gate**: the
  RedCoin's Init reads `ShowHiddenItemsFlag` (set when Yoshi
  passes a checkpoint or uses the magnifying-glass item) and
  picks one of four palette offsets from `DATA_0CE9FE`. When
  the flag is clear, red coins disguise as yellow.

### Multi-sprite, single-collect (the Flower trick)

Two sprite IDs (`$0FA`, `$110`) share a collect routine
(`CODE_0EB525`). This isn't a documented pattern in
spritestateengine.md -- it's roughly Pattern C "shared body for
N variants" but spread across Init/Main rather than collapsed
into one routine. The Flower pop helper RNG-picks between the
two so a level can effectively randomize bloom-animation
without affecting collect mechanics.

---

## 9. Cross-references

- `docs/spritestateengine.md` §3.5 (`$7D36,x` collision marker)
  -- the load-bearing primitive every collectible uses to
  detect Yoshi.
- `docs/spritestateengine.md` §10.2 Pattern E -- Bubbled1up
  3-up sentinel + RedCoin hidden-flag sentinel both demonstrate
  this pattern.
- `docs/family-misc.md` §1 (Door family) -- the LockedDoor
  variants ($04E, $131) that pair with $027 Key. Note that
  the $14 KeyFromBoss is a different sprite (post-boss
  cinematic key) and lives in `docs/family-kamek.md`.
- `docs/family-cinematic.md` §5 (Goal Ring + GOAL Letters +
  flower roulette) -- the consumer of `FlowersCollectedLo` +
  `RedCoinsCollectedLo`.
- `docs/family-clouds.md` -- the five Winged-Cloud variants
  that spawn members of this family on pop:
  `$00B6 WingedCloudWith8Coins`,
  `$00B7 WingedCloudWithBubbled1up`,
  `$00B8 WingedCloudWithFlower`,
  `$00BD WingedCloudWithCoin`,
  `$00BF WingedCloudWithKey`,
  `$00BE WingedCloudWith1up` (which spawns a non-bubbled 1-up
  card, not in scope here).
- `docs/family-eggs.md` §3 (egg-hit dispatch) -- the per-egg
  reward path that funnels through `CODE_make_star_or_coin`
  (smart-picker between Coin $115 and HealthStar $1A2 based
  on player's star total).
- `yi/Constants/AmbientSpriteIDs.asm` (entries for $01BF, $01CD,
  $01E4, $01E7, $01EF, $0226) -- per-ambient behavior catalogue.
- `yi/Memory/WRAM_LevelState.asm` -- where `CurrentCoinCountLo`
  (`$0392`), `RedCoinsCollectedLo` (`$03B4`),
  `FlowersCollectedLo` (`$03B8`),
  `StarsPendingAutoIncreaseLo` (`$0396`), and
  `StarCounterDigit2Lo` (`$03A3`) all live.
- `yi/Memory/SRAM_LevelState.asm` -- where
  `SuperBabyMarioTimerLo` (`$1E04`) and `ShowHiddenItemsFlag`
  (`$1E06`) live.

---

## 10. Open questions

1. **Why does the Flower `$110` Init store `$0009` as the
   bloom-animation target via `CODE_0EB56C`'s state-0 setup
   (`LDY #$09 / STY $16,x`) when the animation only walks 0-3
   in state 1?** State 2 then uses `$16` as the sway endpoint
   (walks `$7402` 0..9). The "9" looks like it represents the
   "fully bloomed" pose's `$7402` tile index for a 10-frame
   tile strip. Verify by looking at the OAM tile strip used
   when `$7402 = 9`.

2. **Are there levels that intentionally place the Key in a
   non-keyhole tile** to make it visually appear but functionally
   dead? `CODE_02A007` failing to find a keyhole tile leaves
   the key's cached position as its spawn -- pickup is allowed
   but unlocks no door. This could be a designer test
   environment or a hack-only behavior, but check if any
   shipped level does this (looking at world-2 castle and
   world-4 fortress key placements would be the best samples).

3. **The HealthStar's `$0B7F = $0082` write on pickup** -- what's
   `$0B7F`? Not listed in `yi/Memory/`. Could be a star-tally
   side-effect (probably setting a "do star-glint OAM" flag for
   the next N frames) or a generic level-state flag. Could be
   the trigger that makes the on-screen star counter visibly
   "pulse" when you collect a HealthStar. Worth grepping for
   any reader.

4. **`CODE_03A4C3` is used by both HealthStar and a few
   non-collectible sprites.** What's the conceptual model
   distinguishing `03A4A2` (full 1-up bookkeeping + sound) vs
   `03A4C3` (just the OAM score-popup)? Maybe `03A4C3` is "I
   already incremented the counter elsewhere, just spawn the
   visual" while `03A4A2` is "I'm awarding a fresh 1-up". Check
   the other callers of `03A4C3`.

5. **The 20th red coin's `SoundID93+1` (= $94?) is undocumented
   in `yi/Constants/SoundIDs.asm`** -- it appears to be reached
   via implicit INC rather than a constant lookup. Add a define
   for whatever this `SoundID94_*` actually plays (probably the
   "all red coins!" fanfare). Worth a separate grep pass.

6. **Does the Super-Star refresh timer logic correctly handle
   the case where the player ALREADY has a star timer running
   and grabs a second Super Star?** Looking at `CODE_029A50:
   LDA #$0200 / STA SuperBabyMarioTimerLo` -- yes, the timer
   resets to $0200, so picking up a second Super Star while
   already in form extends the timer. But what if the timer
   would have expired in the next frame and the player has
   30+ stars (a different powerup gate)? Edge case worth
   tracing.

7. **The Bubbled1up 3-up gate uses `$03A3 == $03`** which is
   the tens digit of the on-screen star counter. But the star
   counter is *displayed* as up to 99 (digits 1+2). At 100+
   stars... is `$03A3` still 3, or does it overflow? Hard to
   answer without tracing the star-counter draw routine in
   Bank00 / Bank0F. Worth checking what the upper bound is
   (whether 3-up at 30+ stars holds true at 99+ stars).
