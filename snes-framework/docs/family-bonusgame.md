# YI Bonus-Game / Mini-Battle family reference

Standalone reference for the Yoshi's Island post-level "side activity"
sprite cluster -- the Item Card, Bucket, balloon-pump trio, Coin Cannon,
Watermelon Pot, and the mini-game-room balloons that the four bandit
mini-battles depend on. Unlike most sprite families, these nine sprites
do not share a base behaviour: they are the **per-room actors of a
mode-driven minigame system** centred on game-modes `$2E` (bandit
minigame dispatcher) and `$30` (mini-battle / "miniboss" tick), with
the bonus-game scenes mixed in alongside as siblings of the same
dispatcher.

This doc complements:

- `docs/family-cinematic.md` -- Goal Ring `$00D` and the post-level
  scene-transition handoff. The goal-ring roulette is what writes the
  level-entrance record that ends up driving `$03A7` (the minigame
  selector); the per-level encoding is documented there.
- `docs/leveldataengine.md` -- the level-clear scoring sequence that
  precedes the minigame, the screen-exit table format
  (`$7F:7E00,x` 4-byte records loaded by Bank10), and the level-data
  blob layout that each mini-battle "room" reuses.
- `docs/spritestateengine.md` -- the engine-side 9-state dispatcher
  every Init/Main entry here layers its own sub-state machine on top
  of (`$76,x` / `$18,x` sub-state byte conventions).
- `yi/Banks/Bank11.asm` -- the mini-battle / minigame bank where 7 of
  the 9 sprites live, plus the `gm2e_main_bandit_minigame` and
  `gm30_miniboss_battle` dispatcher entries that route into them.

Source of truth for all addresses below is the framework asm in
`yi/Banks/Bank11.asm` (main bank), with companion code in `Bank05.asm`
(Bucket), `Bank03.asm` (Mock-Up), `Bank0C.asm` (Balloon Pump +
Deflating Balloon), `Bank01.asm` (level-loader $03A7 hand-off),
`Bank02.asm` (Goal Ring `$00D`), and `Bank00.asm` (the bonus-game 1up
popup chain at AmbSpr `$22B`/`$22C`/`$22D`).

---

## 1. Family at a glance

Nine normal-sprite IDs make up the cluster. They split into four
behavioural sub-groups -- the Item Card (a self-contained mini-game
of its own), the Bucket (a level-prop with a slot-machine show), the
three-sprite Balloon-Bonus minigame, and the four mini-battle actors
that share the `$2E`/`$30` dispatcher.

| Sprite ID | Constant name | Bank | Init handler | Main handler | Sub-state byte | Role |
|-----------|---------------|------|--------------|--------------|----------------|------|
| `$011` | `ItemCard` | 11 | `$11:C8F0` `init_item_card` | `$11:C9A0` `main_item_card` | `$701976` (variant) | Post-level "pick-a-prize" spinning card. Two states (spin / await-stomp), 12-entry prize table at `DATA_11C8D8`. Spawned by the gather-coins win path. |
| `$021` | `Bucket` | 05 | `$05:C46B` `init_bucket` | `$05:C8B6` `main_bucket` | `$76,x` (4 states) | Hanging dispenser. Slot-machine display while idle, roll on Yoshi-collision, drop contents (item or coins) on stop. Shares Init with `$122`/`$123` carrier variants. |
| `$073` | `BalloonPump` | 0C | `$0C:EFC4` `init_balloon_pumper_red_bg3` | `$0C:F005` `main_balloon_pumper_red_bg3` | `$18,x` (3 states) | Red BG3 pump structure. Init spawns paired `$1B0` DeflatingBalloon. Main has idle / pumping / cleanup. Pumps fill `$701976,y` on the partner balloon. |
| `$08B` | `MockUp` | 03 | `$03:E8D0` `init_inflating_balloon` | `$03:E925` (main_inflating_balloon) | `$18,x` (8-entry phase ptr) | The actual Yoshi-target balloon that inflates and pops. Six-phase state machine (wait-proximity / range-check / inflate / pop / cleanup / player-gone / wait-inflate / chase-inflate). |
| `$1B0` | `DeflatingBalloon` | 0C | `$0C:EB10` `init_balloon_bg3` | `$0C:EBBA` `main_balloon_bg3` | `$18,x` (4 states) | The big BG3 balloon attached to the BalloonPump basket. Drives SuperFX `FXCODE_0A8390` for parametric balloon shape. 4-state ptr: inflate / drift / pop / cleanup. |
| `$1B1` | `CoinCannon` | 11 | `$11:B088` | `$11:B125` | `$78,x` (rotation direction) + `$7AF6,x` (firing cooldown) | Gather-Coins mini-battle cannon. Rides a horizontal track between X=$10 and X=$E0, rotates, fires `$1B2` projectiles on sine/cosine arc. Uses `FXCODE_0884A5` for body render. |
| `$1B2` | `MinigameCoin` | 11 | `$11:B23B` | `$11:B24D` | `$7400,x` (facing) + `$7D36,x` (catch state) | Coin pickup fired by the cannon. Awards `$09` SFX + BCD-increments `$10EA` on Yoshi-catch, plays `$2C` clank on ceiling bounce, bandit-catch via `$7D36`. |
| `$1B6` | `MinigameBalloon` | 11 | `$11:A0E6` | `$11:A175` | `$76,x` (11-entry pop+bob dispatch) | Red balloon in the Pop-Balloons mini-battle. 11 states for bob direction / pop animation / score-pop spawn. Uses RNG-gated `CODE_bandit_minigame_coin_result_rng` for jackpot vs regular reward. |
| `$1B8` | `WatermelonPot` | 11 | `$11:C44B` | `$11:C460` | `$18,x` (3 states) | Pot of watermelon seeds for the Seed-Spit mini-battle. Init seeds firing timer from H-counter for desync. Main runs countdown / spawn-seed / wait-seed-clear via `DATA_11C46C`. |

Of these:

- `$011` ItemCard is the **only** sprite in the cluster that appears
  outside of a mini-battle/minigame mode -- it is spawned mid-scene
  inside the bonus-game state machine (`CODE_11864E` / gather-coins
  win path `CODE_11AE73`) and lives in the standard sprite slots.
- `$021` Bucket is a normal level prop; it shows up in regular levels
  (cave / sky bonus areas) and has nothing to do with the mini-battle
  dispatcher. Its slot-machine display is purely cosmetic.
- `$073` + `$08B` + `$1B0` form the BG3 balloon-bonus minigame -- a
  scene that lives inside a regular level, not under gm$2E/$30.
- `$1B1` + `$1B2` + `$1B6` + `$1B8` are the four mini-battle actors;
  none of them function outside the gm$2E/$30 dispatcher (most check
  `$10F8` -- the mini-battle phase byte -- and early-return when not
  in a mini-battle).

---

## 2. Item Card `$011` -- post-level pick-a-prize

The Item Card is the **outcome** card of the bonus-game scenes (sub-modes
0/1/2 of the gm$2E dispatcher; `$1170 = $03/$04/$05`). It is spawned
when the bonus-game animation reaches the "reveal" sub-phase, and once
the player tosses or stomps it, the indicated prize lands in either
the pause-menu inventory (`PauseMenuItemInventory[0..18]`) or the
extra-lives counter.

### 2.1 Init `YI_NorSpr011_ItemCard_Init` (`$11:C8F0`)

`init_item_card` is unusual in that it does **two SuperFX kicks during Init**
(not just one):

1. **First kick (`FXCODE_089BE1`)** -- draws the card border + spinning
   face via the LOOP table at `DATA_11C8C0`. Indexed by `$18,x` (which
   the spawner sets to the prize-card variant number, 1-12).
2. **Second kick (`FXCODE_089BC5`, V1.1 only -- V1.0 uses the first kick)** --
   secondary blit; the prize-card variant table at `DATA_11C8D8` is
   read here, copying $1C bytes of the per-prize graphic into the
   palette mirror at `YI_Global_PaletteMirror[$E1]` via the `LDA.b ($00),y` /
   `STA.l ...,x` loop. The bank holding the source data is set up via
   `PHB / PHY / PLB` to bank `$5F` (`DATA_5FC860`).

The Init also stores the initial spin angle (`$76,x = $20`) and reads
its variant slot from `$18,x` (the byte the spawner set up earlier).

### 2.2 The prize-graphics table `DATA_11C8D8` (`$11:C8D8`)

Twelve 2-byte ROM pointers, each into bank `$5F` SuperFX graphics:

```
dw DATA_5FC860, DATA_5FDFFC, DATA_5FC860, DATA_5FC860,
   DATA_5FC860, DATA_5FC860, DATA_5FC87E, DATA_5FC860,
   DATA_5FDFFC, DATA_5FC860, DATA_5FC860, DATA_5FC860
```

Only three distinct addresses appear: `DATA_5FC860` (the default card
face -- 9 of 12 slots), `DATA_5FDFFC` (a special card face -- slots 2
and 9), and `DATA_5FC87E` (slot 7). This strongly suggests the card
**face graphic does not encode the prize itself** -- the same default
graphic is reused for most prizes, with the prize identity tracked
separately in `$701978,x`.

### 2.3 The actual prize index `$701978,x`

`YI_NorSpr011_ItemCard_Main` -> state 1 (`CODE_11C9DD`) on Yoshi-stomp:

```
LDA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,x
CMP.w #$000A
BCS.b CODE_11CA07           ; if >= 10, go to extra-lives path
JSL.l CODE_109CA6           ; else, item-inventory path
...
CODE_11CA07:
SBC.w #$000A
INC
CLC
ADC.w !RAM_YI_Level_CurrentLifeCountLo
STA.w !RAM_YI_Level_CurrentLifeCountLo
```

So `$701978,x` is the prize index, with semantics:

- `0-9`: item ID into `PauseMenuItemInventory[]` via `CODE_109CA6`
  (Bank10:`$10:9CA6`, which calls `CODE_109C80` -- find first empty slot,
  shift fill if full, store).
- `10-19`: extra lives award. Stored count is `(idx - 10) + 1` =
  1 to 10 lives. Index `$0A` awards 1 life, `$13` awards 10.

### 2.4 Where the prize value gets written

The bonus-game spawn site at `CODE_11864E` (Bank11:`$11:864E`) writes
the prize index using a formula derived from `$1170` (the
bonus-game variant byte the dispatcher stored at gm$2E entry):

```
LDA.w #$0011
JSL.l CODE_spawn_sprite_init
...
PHX
LDA.w $1170
SEC
SBC.w #$0003
CLC
ADC.w #$000A
STA.w !EXRAM_YI_Level_NorSpr_GenericTable701978|!EXRAMBankMirror,y
```

So `$701978,y = ($1170 - $03) + $0A`. Given `$1170 in {$03, $04, $05}`
(the three bonus-game variants), this writes `$0A`, `$0B`, `$0C` --
all in the **extra-lives** range. Concretely: each of the three
bonus-game scenes deterministically awards 1, 2, or 3 lives (the
"prize" the card lands on is hard-coded by the variant). The visual
roulette is cosmetic; the underlying reward is fixed.

The second item-card spawn site is `CODE_11AE73` (gather-coins
win-tally cleanup): when the gather-coins mini-battle ends with Yoshi
ahead of the bandit, the same item card is spawned but with a
**random** `$701978` from `DATA_11AE45 = $06,$04` (so either 6 lives
or 4 lives via the `> $0A` formula).

### 2.5 Spin Main loop

`YI_NorSpr011_ItemCard_Main` (`$11:C9A0`) -- two-state dispatch via
`$701976,x`:

- **State 0** (`CODE_11C9C1`): spin. Each frame: `$76,x += 2`,
  `$78,x += 3 (mod $100)`. When `$76,x` rolls over from `$FE` to `$100`,
  increment `$701976,x` to advance to state 1.
- **State 1** (`CODE_11C9DD`): await Yoshi stomp/tongue. On hit
  (`$7D36,x < 0`): play `$36` (CollectFlower) sfx, free the slot via
  `CODE_03A31E`, set `$10FA = 1` (the mini-battle / minigame "done"
  flag the dispatcher polls in `$1191B8`), and award the prize.

The "spin then stop" visual is therefore **a single revolution of the
card-face animation, not a roulette over multiple prizes** -- the
prize was chosen at spawn time and the spin is just decoration.

---

## 3. Bucket `$021` -- dispenser with slot-machine display

The Bucket is a level prop, not a minigame actor. It hangs in a fixed
spot, animates a "what's inside" slot-machine reel on its face, and
drops its contents when Yoshi knocks it loose. The same `init_bucket`
also serves variants `$122` (BucketWithBandit) and `$123`
(BucketWithCoins), which differ only in payload.

### 3.1 Init `YI_NorSpr021_Bucket_Init` (`$05:C46B`)

Shared with `$122` and `$123`. Sets `$7A36,x = $0100` (the SuperFX
swing-counter), captures spawn position into `$701900/$701902,x` (the
"hang point"), then calls `CODE_05C59F` -- which kicks SuperFX
`FXCODE_0884A5` with the LOOP data at `FXDATA_550000+$20C0` to draw
the bucket body.

Variant-specific tail (lines `$05:C492-C4A0`): if SpriteID == `$021`,
read X-position bit 4 into `$16,x`. This is the **variant byte** for
the slot-machine reel display in state 0; it picks between two reel
positions.

### 3.2 Held-bucket states `DATA_bucket_obj_state_ptr` (`$05:C4A3`)

5 states, dispatched via `$76,x`:

| `$76,x` | Handler | Role |
|---------|---------|------|
| 0 | `CODE_05C5EB` | Idle hang; watch for Yoshi-egg collision via `$7D36,x`. On hit, accumulate "swing" energy. |
| 1 | `CODE_05C6B1` | Knocked: swing past the rest pose, fall back. Increment swing accumulator. |
| 2 | `CODE_05C70D` | Tip / dispense: orient the rotation byte to "tipped" and increment a frame counter; on completion, advance to state 3. |
| 3 | `CODE_05C766` | Empty rocking: while the bucket is being released, runs a rotation oscillation; per-variant dispense at `DATA_bucket_empty_state_ptr`. |
| 4 | `CODE_05C79E` | Settle / despawn: tick down timer, then despawn the bucket frame. |

Variant `$122` / `$123` use this state machine (their Main is
`main_bucket_obj`). Plain `$021` switches into a **second** state
machine after release, documented next.

### 3.3 Plain Bucket Main `YI_NorSpr021_Bucket_Main` (`$05:C8B6`)

`$021` shadow-runs the same `$76,x` byte, but with a different state
table `DATA_bucket_main_state_ptr` (`$05:C8AE`):

| `$76,x` | Handler | Role |
|---------|---------|------|
| 0 | `CODE_05C8F6` | Idle in slot-machine display mode. The display is just frame animation; the value picked has no in-game effect. |
| 1 | `CODE_05C922` | Rolling animation (bucket has been knocked; reel is "spinning"). |
| 2 | `CODE_05C958` | Stopped, contents dispensed. Reads `$7862` to pick X-velocity from `DATA_05C954 = $0200, $FF80`. |
| 3 | `CODE_0580C2` | Shared GSU delta-facing stub (the standard "I'm flying loose" tumble drawer). |

The Bucket-Yoshi-collision result is **decoupled from the slot-machine
reel**: the reel animation is purely cosmetic.  The "what comes out of
this bucket" is determined entirely by the SpriteID variant: `$021` →
nothing useful (just bounces away after a flash); `$122` → spawns a
Bandit `$020`; `$123` → showers nine coins (`$115`) in a star pattern
via `CODE_05C85F`. The slot-machine display has **no gameplay effect**
on plain Bucket `$021`. It is a red herring.

### 3.4 The award byte

The Bucket Main near `$05:C8E5` writes `$0CCA = $10` when Yoshi is
adjacent (`$7C16,x` within `$28`, `$7C18,x - $6122` within `$14`):

```
LDA.w #$0010
STA.w $0CCA
```

`$0CCA` is the player-state "I'm holding a bucket" flag (`$10` =
holding-bucket); the player state engine then drains it through the
"hold" animation and applies the bucket-contents dispense. So **the
plain `$021` Bucket transfers nothing into Yoshi's inventory**; it is
strictly a prop / interaction trigger.

---

## 4. The Balloon-Bonus minigame -- `$073` + `$08B` + `$1B0`

The Balloon-Bonus is a small mid-level reward minigame: a red pump on
the ground (`$073`), a big colorful BG3 balloon attached to it
(`$1B0`), and a separate "target" balloon (`$08B`) that the player
must fully inflate by standing on the pump. The pump fills a counter
on the partner balloon; once full, the target balloon pops with a
score-pop reward.

This mini-game lives inside **regular level flow** -- it does not use
the gm$2E/$30 dispatcher.

### 4.1 BalloonPump `$073` (Bank0C)

`YI_NorSpr073_BalloonPump_Init` (`$0C:EFC4`):

1. Test `$0CB2` (the "already spawned my partner balloon" flag).
   If non-zero, jump to despawn (`CODE_03A31E`) -- prevents duplicate
   pump spawns from generators.
2. Spawn a `$1B0` (DeflatingBalloon) at `+$10` X / `+$04` Y relative
   to the pump.
3. `INC $0CB2` to mark the pair as created.
4. Store the slot index of the partner balloon into `$78,x` (the link
   byte the Main loop uses to address the partner).
5. Set initial pump-pressure `$16,x = $0100`.

Main (`$0C:F005`) -- 3-state dispatch via `$18,x`:

| `$18,x` | Handler | Role |
|---------|---------|------|
| 0 | `CODE_0CF06C` | Idle; wait for Yoshi-on-pump (`$0E` flag set externally). On detect, pick X-velocity from `DATA_0CF068 = $FFFC, $FFE0` based on `$60D4` (a control-direction byte), play `$96` (BalloonPump) sfx, advance to state 2. |
| 2 | `CODE_0CF0A9` | Pumping: decrement pressure (`$76,x`), accumulate inflation into partner's `$701976,y` (the partner's fill counter). Halt at `$0100`. While accumulating, the rotation byte `$7A36,x` modulates so the pump piston animates. Exit back to state 0 when player leaves. |
| 4 | `CODE_0CF135` | Cleanup: cap `$16,x` at `$20` (drained pressure), wait. |

The state advance from 0 to 2 is via two `INC $18,x` (`SEP $20 / INC.b
$18,x / INC.b $18,x / REP $20`), skipping odd `$18,x` values. From 2
back to 0 is the dual decrement at `$CF0AC`.

### 4.2 DeflatingBalloon `$1B0` (Bank0C)

`YI_NorSpr1B0_DeflatingBalloon_Init` (`$0C:EB10`) is structured as a
**BG3 graphic setup**: it stores a save-restore of the main-screen
mask into `$701902,x`, then per-tileset (`$0C:EB30` test on
LevelHeaderBG2Tileset = `$16`) either:

- Sets up the multi-byte HDMA channel 3 + 4 destinations to
  `$REGISTER_BG2HorizScrollOffset / VertScrollOffset` so the balloon
  shape can scroll the BG3 layer behind it,
- OR (other tilesets) just copies `DATA_5FE34C` -- 9 bytes of palette
  -- into the master mirror.

Then sets `$7542,x = $0002` (gravity), `$75E2,x = $0040` (drag),
captures spawn-relative position into `$7680/$7682,x`.

Main (`$0C:EBBA`):

1. Per frame: drives `FXCODE_0A8390` (the parametric balloon-shape
   renderer) with Yoshi-relative coords (`$EXRAM_Player_XPosLo -
   Layer1XPosLo`) and the frame-counter byte for animation.
2. On `$601A` non-zero (the "Yoshi-on-balloon" flag the SuperFX code
   returns), pull Yoshi upward by `$601C + 2` per frame -- this is the
   inflation = ascend mechanism.
3. On `$6014` (Yoshi adjacent), tick the X-vel reversal logic via
   `DATA_0CEBB2 = $0014, $000A` / `DATA_0CEBB6 = $0001, $FFFF`
   (vertical drift bias toward Yoshi).
4. Dispatch to `DATA_deflating_balloon_state_ptr` (`$0C:ECB6`):

| `$18,x` | Handler | Role |
|---------|---------|------|
| 0 | `CODE_0CECBE` | Inflate phase: tick `$75E2 -= YSpeed`; when it crosses the threshold at `$7542`, flip YSpeed sign. |
| 2 | `CODE_0CECE0` | Drift: hold in the air, accept inflation from the partner pump's `$701976` accumulator. |
| 4 | `CODE_0CECE6` | Pop: triggered when fill reaches the threshold. (Routine off-screen of the snippet; spawns a fade-out particle + score-pop.) |
| 6 | `CODE_0CECDD` | Cleanup: despawn after pop animation. |

### 4.3 Mock-Up `$08B` (Bank03) -- the target balloon

The Mock-Up is **not** the balloon that the pump inflates -- it is a
**separate** balloon-shaped target that floats around the room and
inflates either while Yoshi is in proximity or being chased. (The
sprite is also used as the target for the egg-throw "pop the balloons"
games inside regular levels.)

`YI_NorSpr08B_MockUp_Init` (`$03:E8D0`):

1. `JSL CODE_03D3F8` -- check "is this spawned from a generator?"
   carry-flag style. If yes, despawn.
2. Snapshot spawn position into `$7A36/$7A38,x` (the "home" point).
3. Read `$701900,x` -- the variant byte:
   - If zero: this is a fresh inflate from scratch. Seed
     `$701901,x = $20` (inflation counter, BCD-incremented during the
     phase 6 inflate state) and `$701902,x = $02` (palette/priority
     bias). Derive variant from `(spawn-X & $10) >> 3 + 1` (so left/right
     spawn columns get variants 1 and 2).
   - If non-zero: this is a chase-spawn (a Mock-Up that has migrated to
     a new position during phase E). Jump straight to state `$0A`
     (cleanup).
4. Set palette priority bit in `$7042,x` from `DATA_03E8CC =
   $0000, $0002` indexed by the variant -1.

Main (`$03:E925`) dispatches via 8-entry table `DATA_inflating_balloon_state_ptr`
(`$03:E8BC`):

| `$18,x` | Handler | Role |
|---------|---------|------|
| 0 | `CODE_inflating_balloon_phase0_wait_proximity` | Wait until Yoshi within `$C0` of the home point; arm `$7542 = $40`, `$75E2 = $0400`. On the floor-bit set (`$7860 & 1`), advance to state 2. |
| 2 | `CODE_inflating_balloon_phase2_range_check` | Tick the proximity test each frame; if Yoshi leaves the `$C0` X+Y box, fall to state 4 (player-gone). |
| 4 | `CODE_inflating_balloon_phase6_inflate` | Inflate. Each frame: `$701901,x += 2`. On overflow ($FF -> $00), clamp to $FF, advance to state $06 (pop). |
| 6 | `CODE_inflating_balloon_phase8_pop` | Pop. Palette-flicker effect (XOR `$7042` with `DATA_inflating_balloon_pop_priority_mask`). On the timer expiring, spawn AmbSpr `$1EE` (the pop-flash effect), play SFX `$3B` (Pop), and award score via `CODE_03A858` if Yoshi is in range. |
| 8 | `CODE_03EB50` (`inflating_balloon_phaseA_collide`) | Collide: if Yoshi-egg/swallow contact, jump to pop. Otherwise, bounce-off with X-velocity from `DATA_03EB4C = $0800, $F800`. |
| 10 | `CODE_inflating_balloon_phase4_player_gone` | Player-gone recovery: when Yoshi re-enters range, set wind speeds `$7540 = $7542 = $0010` and advance to state $0C. |
| 12 | `CODE_03E9E4` (`inflating_balloon_phaseC_wait_inflate`) | Wait until `$701901,x` reaches $80, advance to state $0E. |
| 14 | `CODE_03E9F5` (`inflating_balloon_phaseE_chase_inflate`) | Chase: SuperFX `FXCODE_09907C` computes vector toward Yoshi (`$611C/$611E` minus position), writes inverted into `$75E0/$75E2`. Then JMPs into phase 6 inflate -- the chase continues inflating while moving. |

Note that **states 0/2/4/6** are the canonical "inflate-and-pop"
sequence the player-driven minigame uses; **states 8/10/12/14** are
the "I am a free-floating chase target" alternate flow used when the
Mock-Up is spawned by the gather-coins mini-battle as a decoy.

---

## 5. The Coin Cannon minigame -- `$1B1` + `$1B2`

The Coin Cannon is a single-actor mini-battle: a cannon platform rides
along a horizontal track while firing coin pickups in a sine/cosine
arc. Yoshi competes with the `$1B3` (GatherCoinsBandit) for the
loose coins; the player with more in their BCD-counter `$10E8` /
`$10EA` at expiry of `$10EC` (a BCD countdown) wins.

### 5.1 Per-variant init `CODE_init_mini_battle_gather_coins` (`$11:AD79`)

This is the gm$2E/$30 sub-mode 4 init (slot 4 in
`DATA_bandit_minigame_init_ptrs`). It:

1. Resets BG-layer scroll, sets BG1 addr `$69`, BG2 addr `$39`, BG-mode
   `$09` (8x8 single-layer with BG3 priority mask).
2. Initializes coin counters: `$10EC = $0030` (BCD countdown frames),
   `$10EE = $0001` (frame-tick subcounter), `$10E8 = $0000` (Yoshi's
   coin count), `$10EA = $0000` (bandit's coin count).
3. Spawns `$1B1` CoinCannon, then `$1B3` GatherCoinsBandit.

The Main tick (`CODE_main_mini_battle_gather_coins`) at `$11:AE1A`
dispatches via 3-entry table `DATA_11AE3F` indexed by `$10F8` (the
mini-battle "phase byte"):

| `$10F8` | Handler | Role |
|---------|---------|------|
| 0 | `CODE_11AE47` | Active play. Spawns ItemCard at end of game (`$10EC == 0` and player won), seeds the ItemCard's `$701978,y` with random `$06` or `$04` (DATA_11AE45) -- prize is 6 or 4 extra lives. |
| 2 | `CODE_11AEAC` | Win cleanup; on $60C0 (the "scene-fade" timer) reaching zero, advance phase + freeze Yoshi. |
| 4 | `CODE_11AEC9` | Loss cleanup; immediate freeze + jump to scene-exit dispatcher (`CODE_bonus_game_state_dispatcher`). |

The BCD scoring core at `CODE_11AEDC` (`$11:AEDC`):

```
SED
LDA.w $10E8           ; Yoshi's score
ADC.w $03BA           ; per-frame delta (set by coin pickup)
STA.w $10E8
CLD
DEC.w $10EE           ; frame-subcounter
BNE done
SED
LDA.w $10EC           ; BCD countdown
SBC.w #$0001
STA.w $10EC
CLD
BEQ end_battle        ; if zero, compare scores and pick winner
...
SFX $7F (SwitchTimerEnding) at $10EC <= $0006
$10EE = $003F         ; reset frame-subcounter (so countdown ticks every $40 frames)
```

Winner is determined by `LDA $10E8 / CMP $10EA / BCS yoshi_wins`,
which sets `$10E6 = 0` (Yoshi won) or `$10E6 = 1` (Bandit won).

### 5.2 CoinCannon `$1B1` (Bank11)

`YI_NorSpr1B1_CoinCannon_Init` (`$11:B088`):

1. Position to `(X=$70, Y=$38)` -- centre-top of the arena.
2. `$701902,x = 0` -- the track-direction index. Read `DATA_11B084 =
   $FF00, $0100`,y → X-speed `$FF00` (leftward) for first spawn.
3. `$7A96,x = $0040` -- the firing-cooldown timer.
4. Kick `FXCODE_0884A5` with LOOP at `FXDATA_550000+$0080` to render
   the cannon body (subroutine `CODE_11B0BC`).

Main (`$11:B125`):

- Early-out if `$10F8 != 0` (the mini-battle is in win/loss cleanup).
- If `$7A96,x` is still nonzero, run the rotation loop (`$16,x`
  incrementally; AND with `$03` so only every 4th frame rotates;
  `$7A36,x` is the absolute angle, indexed into `DATA_gather_coins_cannon_rotation_distances`
  and `DATA_gather_coins_cannon_rotation_speeds`).
- When `$7A96` hits zero, fire a coin: spawn `$1B2`, compute X/Y-speed
  from `DATA_sine_lut_8bit_radians` / `DATA_cosine_lut_8bit_radians`
  indexed by `($7A36 + $40) << 1` (so the firing direction is the
  cannon's current angle rotated by 90 degrees, i.e. perpendicular to
  the cannon body).
- Also spawn AmbSpr `$22A` for the muzzle flash, play SFX `$47`
  (Explosion).
- After firing, indexed pickup of new cooldown from `DATA_11B11B =
  $000A,$000A,$0010,$0004,$0000` -- if zero, increment `$18,x` (the
  shot-count byte) and reset `$7A96 = ($10 & $3F) + $40` (so cooldown
  is randomised between `$40` and `$7F` frames).
- Edge-bounce on track: at X position equal to
  `DATA_gather_coins_track_distances,y = $0018, $00C8`, reverse
  `$701902,x` (the track-direction index), then reload X-speed from
  `DATA_11B084,y` with the new index.

The two-way track therefore oscillates between X=$18 and X=$C8.

### 5.3 MinigameCoin `$1B2` (Bank11)

`YI_NorSpr1B2_MinigameCoin_Init` (`$11:B23B`):

- Seeds `$7400,x` (facing direction) from X-speed sign: positive →
  `$00` (right-facing), negative → `$02` (left-facing).

`YI_NorSpr1B2_MinigameCoin_Main` (`$11:B24D`):

1. Early-out if `$10F8 != 0` (mini-battle in cleanup; skip catch logic).
2. `LDY $7D36,x` -- collision target slot.
   - **`$7D36,x = 0` (no collision)**: gravity / friction logic at
     `CODE_11B2C4`. On floor-bit set (`$7860,x & 1`), if Y-speed is
     negative (rising), reverse it (bounce). If Y-speed magnitude
     drops below `$FFF0`, just settle with `$2C` (ClankSound5) SFX.
   - **`$7D36,x > 0` (sprite collision; usually the Bandit)**: at
     `CODE_11B255`, `DEY` (so Y = bandit-slot). Test `$7A36,y` (stun
     state). If zero (bandit is alive), increment **bandit's BCD coin
     counter** at `$10EA`, decrement `$03BA` (the "Yoshi's
     delta-this-frame" -- so if Yoshi was about to score, it's
     reversed), spawn a "collected" animation, JML to despawn.
   - **`$7D36,x < 0` (Yoshi collision)**: at `CODE_11B284`, increment
     Yoshi's `$03BA` delta, play SFX `$09` (Coin), despawn.

So each coin can be claimed by either Yoshi or the Bandit; the first
to touch it wins it. The BCD counter `$10E8` is **Yoshi's**, `$10EA` is
**Bandit's**.

---

## 6. The Pop-Balloons mini-battle -- `$1B6` (Bank11)

The Pop-Balloons room (gm$2E/$30 sub-mode 5 = "facing left",
sub-mode 6 = "facing right") is a small enclosed arena with 10 red
balloons floating around, 2 platforms (`$1B4` CheckeredPlatform), and
1 bandit (`$1B5` PoppingBalloonsBandit). Yoshi pops balloons by
shooting eggs; certain pops trigger the bonus-game 1up popup via the
shared RNG `CODE_bandit_minigame_coin_result_rng`.

### 6.1 Per-variant init (`CODE_init_mini_battle_pop_balloons_left/right`, `$11:9D91/9D98`)

Seeds `$113C = 0` (left) or `$113C = 1` (right) -- the "facing
direction" of the arena. Then in shared body `CODE_119D9D`:

1. Spawn 2x `$1B4` CheckeredPlatform.
2. Spawn 10x `$1B6` MinigameBalloon in a loop.
3. Spawn 1x `$1B5` PoppingBalloonsBandit.

The 10 balloons get unique X/Y slots from `DATA_11A0B2/DATA_11A0CA`
via the slot-counter at `$10FE` (incremented by 2 per spawn). For
balloons in slot positions 4 and 6 (i.e. the **5th and 7th spawned**),
the slot index is stamped into `$78,x` of the balloon -- those two
balloons are "tethered" to platforms via the bandit-balloon catch
logic.

### 6.2 MinigameBalloon `$1B6` Init (`$11:A0E6`)

Slot-X/Y pull pattern identical to `$1B4`; for balloons #5 and #7,
the slot index is stored to `$78,x` so the Main can mirror that
platform's X position.

### 6.3 MinigameBalloon `$1B6` Main (`$11:A175`) -- 11-state dispatch

`DATA_11A193`:

| `$76,x` | Handler | Role |
|---------|---------|------|
| 0 | `CODE_11A661` | Idle bob. Test for Yoshi-tongue collision (X within `$08-$28` of balloon, Y within `$1C` of player Y); on hit, set animation state, mark as "claimed" via `$7A36,x = 1`, advance to a pop state. |
| 2 | `CODE_11A392` | Pop-up-right bob increment. Move +6 X / +1 Y per `$08`-aligned frame. |
| 4 | `CODE_11A3CF` | Pop-up-right faster (movement +$0C X / +$0220 Y). |
| 6 | `CODE_11A40F` | Pop-up-left mirror (-6 X / +1 Y). |
| 8 | `CODE_11A44E` | Pop-up-left faster (-$0C X / +$0220 Y). |
| 10 | `CODE_11A490` | Yoshi-grab: on contact, set Yoshi Y so the balloon "lifts" Yoshi; pick random pop state from `CODE_11A741`. |
| 12 | `CODE_11A514` | **Pop with RNG-reward**. Spawn the 1up bonus popup chain. |
| 14 | `CODE_11A333` | Bob down. Inverse bob direction. |
| 16 | `CODE_11A1A9` | Slow drift up. Used when balloon is at top of arena. |
| 18 | `CODE_11A1E9` | Drift down. Mirror of $10 going downward. |
| 20 | `CODE_11A22B` | **Pop with RNG-reward** (variant 2 -- the bandit-claimed pop). |

States 12 and 20 both call `CODE_bandit_minigame_coin_result_rng`
(`$11:A61A`). The two paths differ in **which slot owns the popup
chain** (`$112E` vs `$7972`), but both spawn `$22B` (jackpot row head)
on jackpot or `$22C` (regular row head) otherwise.

### 6.4 The coin-result RNG `CODE_bandit_minigame_coin_result_rng` (`$11:A61A`)

```
PHY
JSL CODE_random_number_gen
LDY $1130                ; current "consecutive jackpot count" state
BMI no_more_jackpot      ; if signed bit set ($FF prefix), return $22C immediately
SEP $20
LDA $10                  ; low byte of RNG output
AND #$1F                 ; mask to 5 bits (0-31)
CMP DATA_11A657,y        ; threshold table
BCC jackpot              ; below threshold → jackpot
no_more_jackpot:
REP $20
LDA #!Define_YI_AmbSpr22C  ; regular (non-jackpot) head
BRA done
jackpot:
REP $20
LDA #$F0F0               ; arm "no more jackpots this scene" flag
STA $1130
... clear AmbSpr slots 0-$3C ...
LDA #!Define_YI_AmbSpr22B  ; jackpot head
done:
INC $1130                ; advance jackpot counter for next call
PLY
RTS

DATA_11A657: db $01,$01,$03,$03,$03,$07,$07,$0F,$0F,$FF
```

The threshold table is the key. As `$1130` ticks 0,1,2,...,9, the
acceptance threshold is `$01,$01,$03,$03,$03,$07,$07,$0F,$0F,$FF`.
Reading a 5-bit RNG value (range 0-31, uniform):

- `$1130 = 0`: P(jackpot) = 2/32 = 6.25%
- `$1130 = 1`: P(jackpot) = 2/32 = 6.25%
- `$1130 = 2`: P(jackpot) = 4/32 = 12.5%
- `$1130 = 3,4`: P(jackpot) = 4/32 = 12.5%
- `$1130 = 5,6`: P(jackpot) = 8/32 = 25%
- `$1130 = 7,8`: P(jackpot) = 16/32 = 50%
- `$1130 = 9`: P(jackpot) = 32/32 = 100% (guaranteed)

So the longer the player goes without a jackpot, the higher the chance
of one on the next call -- a **pity / streak-breaker** distribution
that guarantees a jackpot within at most 10 calls. After a jackpot is
awarded, `$1130 = $F0F0` (the `BMI` short-circuit), which means
**only one jackpot per minigame**.

This RNG is also used by the bandit-mini-battle ItemCard path (gather-coins
finalisation calls into the same RNG via `CODE_11AE73`, but at a
different consumer site).

---

## 7. The Watermelon-Spit mini-battle -- `$1B8` (Bank11)

The Seed-Spit minigame is a 1-player or 2-player room with 6 watermelon
pots `$1B8` arranged around the floor + 1 bandit `$1B7` (or two `$1B9`
in 2P) at the centre. The pots eject watermelons (sprite `$107`) at
random intervals; Yoshi swallows them and spits seeds at the bandit.
Whoever runs out of "ammo" (the `$1100`/`$1102` counters) first loses.

### 7.1 Per-variant init `CODE_init_mini_battle_watermelon_spit` (`$11:B76E`)

1. Reset BG-layers, set BG-mode `$09`.
2. Initialize counters: `$1100 = $1102 = $0008` (each player starts
   with 8 ammo).
3. Set `$6EB6/$6EB8/$6EBA = $FFFF` (reserved-slot sentinels).
4. Load the seed-spit-arena level data at `DATA_15FCEB` (the
   `LevelDataPtr` is set to this address; `CODE_load_level_object_stream`
   then parses the standard object/sprite stream).
5. Spawn 1x `$1B7` SeedSpittingMinigameBandit (1P) or 1x `$1B9`
   (2P variant in `CODE_init_mini_battle_watermelon_spit_2p` at
   `$11:C506`).
6. Spawn 6x `$1B8` WatermelonPot at hard-coded positions:
   - Pot 1: stays where spawn helper put it (the first JSL).
   - Pot 2: `(X=$30, Y=$50)`
   - Pot 3: `(X=$B0, Y=$40)`
   - Pot 4: `(X=$20, Y=$90)`
   - Pot 5: `(X=$A0, Y=$80)`
   - Pot 6: `(X=$90, Y=$C0)`

The Main tick (`CODE_main_mini_battle_watermelon_spit` at `$11:B85C`)
runs the per-phase dispatcher (3-state table `DATA_11B886`),
identical structure to the gather-coins Main but using `$10F0` as the
"slow-game-end" timer instead of `$10EC`.

### 7.2 WatermelonPot `$1B8` Init (`$11:C44B`)

```
LDY $REGISTER_SoftwareLatchForHVCounter
LDY $REGISTER_PPUStatusFlag2
LDA $REGISTER_HCounter
CLC
ADC $10              ; frame counter low byte
STA $10              ; mix back
AND #$00FF
STA $7A96,x          ; initial firing-timer
```

This is a **per-pot desync seed**: the H-counter sample plus the
frame counter (a quasi-random source) is masked to a byte (range 0-255)
and stored as the initial firing cooldown. This guarantees that the 6
pots spawn at different sub-frames within game-mode 30 and therefore
**fire on offset schedules** -- visually the field of watermelons
appears chaotic rather than synchronised.

### 7.3 WatermelonPot `$1B8` Main (`$11:C460`) -- 3-state dispatch

`DATA_11C46C`:

| `$18,x` | Handler | Role |
|---------|---------|------|
| 0 | `CODE_11C482` | Countdown idle. Tick `$7A96,x`. On zero (and `$10FE != 2`), pick a random spawn-table index from RNG-output `$1970 & 7`; use it as an index into `DATA_11C472 = $0007,$0007,$0009,$0007,$0007,$0009,$0007,$0007` (a sprite-ID -- $07 = the default watermelon, $09 = a "rotten" variant). Spawn the watermelon, advance to state 1. |
| 1 | `CODE_11C4E3` | Wait-for-Yoshi: per frame, decrement the watermelon's Y position by 1 (it falls / hovers). After `$16,x` frames, advance to state 2. |
| 2 | `CODE_11C4F3` | Wait-for-watermelon-cleared: on watermelon's `$CurrentStatus,y = 0` (it has been swallowed or despawned), reset to state 0 with `$7A96 = $0100` and decrement `$10FE` (the active-watermelon counter). |

`DATA_11C472`'s entries: 6 of 8 slots are `$0007` (default watermelon),
2 of 8 are `$0009` (rotten). So **~25% of spawned watermelons are
rotten** (causing Yoshi to spit harmlessly, no seed).

The "rotten" jackpot logic is in `CODE_11C4B0`: if `$1110 < $04`
(the recent-rotten counter), still allow rotten; otherwise force to
default (`Y = #$07`). So at most 3 consecutive rotten spawns are
permitted before forcing a real watermelon.

### 7.4 2P seed-spit `CODE_main_mini_battle_watermelon_spit_2p` (`$11:C5FA`)

Identical to the 1P Main except for an early check:

```
LDA $1100             ; player 1 ammo
BEQ p1_lost
LDA $1102             ; player 2 ammo
BNE in_progress
p1_lost:
LDA #$01
STA $10FA            ; arm scene-end
```

So either player running out triggers scene end. The bandit `$1B9`
spit logic at `$11:C679` decrements `$1102` (player 2 ammo) on a
successful hit -- making the bandit the "opposing player" in the 1P
version too.

---

## 8. Minigame mode integration -- the gm$2E / gm$30 dispatcher

### 8.1 Entry from level-loader

The level-loader at `CODE_01B029` (Bank01:`$01:B029`) reads the
"next entrance" record from `$7F:7E00 + $038E*4`:

```
LDA.l $7F7E00,x       ; entrance type byte
AND.w #$00FF
CMP.w #$00DE
BCC normal_level_load
SBC.w #$00DE          ; encoded sub-mode = (byte - $DE)
ASL                   ; double for word-index
STA.w $03A7           ; store the sub-mode (word, even-only: 0,2,4,...,22)
LDA.l $7F7E03,x       ; $0374 (return-target?)
LDA.l $7F7E01,x       ; $0375
LDA $StarTimer        ; $0377 saved
JML CODE_gm2e_main_bandit_minigame
```

The screen-exit table in the level data therefore encodes minigame
selection as a value `>= $DE`, with the offset `(value - $DE)` being
the sub-mode index 0-11. The 12 sub-modes:

| `$03A7` (×2) | Init handler | Main handler | Music | Variant `$1170`/`$10F2` |
|--------------|--------------|--------------|-------|--------------------------|
| 0 | `CODE_1180E8` | `CODE_11825E` | $A2 | bonus-game v3, palette 0 |
| 1 | `CODE_1180EE` | `CODE_11825E` | $A2 | bonus-game v4, palette 0 |
| 2 | `CODE_1180F4` | `CODE_11825E` | $A2 | bonus-game v5, palette 0 |
| 3 | `CODE_11B6DC` | `CODE_11B6DD` | $A3 | RTS stub (unused / scratch) |
| 4 | `CODE_init_mini_battle_gather_coins` | `CODE_main_mini_battle_gather_coins` | $A3 | gather-coins mini-battle |
| 5 | `CODE_init_mini_battle_pop_balloons_left` | `CODE_main_mini_battle_pop_balloons` | $A4 | pop-balloons (left) |
| 6 | `CODE_init_mini_battle_pop_balloons_right` | `CODE_main_mini_battle_pop_balloons` | $A4 | pop-balloons (right) |
| 7 | `CODE_11B764` | `CODE_11B765` | $A6 | RTS stub |
| 8 | `CODE_1180E5` | `CODE_1180E5` | $A7 | no-op (`SEP $30 / RTS`) |
| 9 | `CODE_init_mini_battle_watermelon_spit` | `CODE_main_mini_battle_watermelon_spit` | $A5 | seed-spit 1P |
| 10 | `CODE_init_mini_battle_watermelon_spit_2p` | `CODE_main_mini_battle_watermelon_spit_2p` | $A5 | seed-spit 2P |
| 11 | `CODE_1180FA` | `CODE_11825E` | $A2 | bonus-game v3, palette 1 |

(Per-sub-mode music IDs from `DATA_mini_battle_music_ids` at
`$11:820A`. Music IDs `$A2`-`$A7` are minigame tracks.)

**Slots 3, 7, and 8 are dead** -- they are RTS stubs and never produce
any visible result. The level-loader could route to them via entrance
values `$E1` ($DE+3), `$E5` ($DE+7), or `$E6` ($DE+8) and the
dispatcher would invoke them, but no shipped screen-exit appears to
do so. They are likely scratch slots / placeholders for cut content.

The four mini-battles (slots 4, 5+6, 9, 10) are the "post-level
roulette" set; the three bonus-game scenes (slots 0, 1, 2, also 11) are
the "Bonus Challenge"-style 1up reward scenes that played after world
maps in early development and were repurposed into the random-bonus
trigger.

### 8.2 The bonus-game state machine `CODE_bonus_game_state_dispatcher` (`$11:91B8`)

The three bonus-game variants (sub-modes 0/1/2) share the per-frame
ticker `CODE_11825E` (gm$30 case in the dispatch table), which calls
`$1182AD` to advance the bonus-game scene via the 3-state dispatcher
indexed by `$797C`:

| `$797C` | Handler | Role |
|---------|---------|------|
| 0 | `CODE_1182D3` | Palette flash / intro. Cycle palette in the master mirror; once palette index reaches `$01FF`, advance to state 2. |
| 2 | `CODE_118443` | Mid: spawn the Item Card (`$0011`) at `(X=$38, Y=$80)`, set its prize byte to `(($1170 - $03) + $0A)`. Advance to state 4. |
| 4 | `CODE_1184EC` | Outro: wait for `$10FA` (Yoshi-stomped-card flag) to fire, then advance to scene-end via `CODE_11AD2A`. |

`CODE_11AD2A` (the universal "exit minigame" routine at `$11:AD2A`) does:

1. Save game (`CODE_save_game`) with `$1135 = $7F` temporarily set
   (so the save knows it's a bonus save).
2. If `$0374 = $FF`, jump to GameMode `$1F` (the "back to overworld"
   handler).
3. Otherwise: write `$0374` (the return-level ID) to `$7F:7FC0`,
   `$0376` to `$7F:7FC2`, set `$038C = 1`, set GameMode `$0B` (world
   map), `$038E = $01C0` (overworld scroll target), restore the
   star-timer from `$0377`.

So the bonus-game scenes save then transition back to the world map.

### 8.3 Mini-battle integration with the Goal Ring `$00D`

The Goal Ring `$00D` (sprite, Bank02 -- documented in
`docs/family-cinematic.md`) does **not** itself write `$03A7`. The
goal-ring sequence advances the game-mode and triggers level-exit;
the next entrance record (loaded by `CODE_01B029`) is what selects the
minigame. That entrance value is embedded in the **level header data**
and was set by the level designer at authoring time -- so the choice
of which minigame plays after a given level is **static per-level data**,
not a runtime roulette.

The "roulette" the player sees on the Goal Ring face (the spinning
flowers, key, egg, huffin-puffin icons) is purely the **inventory
display** of what Yoshi has collected during the level
(`CODE_goal_ring_state_02_award_items` at `$02:AB65` iterates the
egg-inventory and animates each collected item). The reward at the
**end** of the goal-ring sequence is not changed by the spin -- the
spin is item-collection visualization, not minigame selection.

This is the surprising finding: there is **no roulette-based selection**
of which mini-battle plays. The level designer chose the post-goal-ring
minigame when authoring the level's entrance/exit table. The player's
actions during the level cannot change which mini-battle plays.

### 8.4 The bonus-game 1up popup chain (Bank00)

After Yoshi pops a `$1B6` MinigameBalloon (or the bandit gets the
result via the gather-coins win path), `CODE_bandit_minigame_coin_result_rng`
returns one of two AmbSpr IDs: `$22B` (jackpot head) or `$22C`
(regular head). The consumer (`CODE_11A22B` / `CODE_11A527`) then
calls `CODE_spawn_ambient_sprite` and positions the new slot just
above where the balloon was.

The AmbSpr Main handlers `CODE_ambient_main_bonus_1up_jackpot_head`
($22B) and `CODE_ambient_main_bonus_1up_regular_head` ($22C) -- both
in Bank00 -- then drive the visible 1up popup column:

- `$22B` (jackpot) advances a frame counter `$7E4E,x` from 0 to $0E;
  during this, the column accumulates 14 letters of the "1-UP"
  popup. Once the counter hits $0E, it calls
  `CODE_ambient_helper_spawn_bonus_1up_popup_tail` which spawns a
  `$22D` AmbSpr (the tail particle).
- `$22C` (regular) is structurally identical but spawns `$22E`
  (a different fade-out particle) at a different Y-speed threshold.

The actual **1up award** (incrementing `CurrentLifeCount`) is queued
*earlier* by `CODE_ambient_helper_init_1up_popup_state` at the `$22B`
spawn site, not by the popup tail itself. The popup tail just drives
the visible flying-letter effect.

---

## 9. Cross-references

- `yi/Banks/Bank11.asm` -- main minigame / mini-battle bank.
- `yi/Banks/Bank05.asm` -- Bucket (`$021`/`$122`/`$123`).
- `yi/Banks/Bank0C.asm` -- BalloonPump (`$073`) + DeflatingBalloon (`$1B0`).
- `yi/Banks/Bank03.asm` -- Mock-Up (`$08B`) with its 8-state inflation
  dispatcher; also the Init/Main pointer registration for `$073`,
  `$08B`, `$1B0`.
- `yi/Banks/Bank01.asm` -- `CODE_01B029` level-loader hand-off
  (entrance value `>= $DE` -> gm$2E).
- `yi/Banks/Bank02.asm` -- Goal Ring `$00D` (the inventory visualizer
  that precedes the mini-battle, but does not select it).
- `yi/Banks/Bank00.asm` -- AmbSpr `$22B`/`$22C` 1up popup row heads
  (`CODE_ambient_main_bonus_1up_jackpot_head` etc.).
- `yi/Banks/Bank10.asm` -- `CODE_109CA6` item-inventory insert helper;
  `CODE_108BDA` screen-exit table decoder that populates `$7F:7E00,x`.
- `yi/Constants/NormalSpriteIDs.asm` -- canonical sprite-ID list.
- `docs/family-cinematic.md` -- Goal Ring + post-level cinematic
  scene-transition chain (the sibling doc that owns `$00D`).
- `docs/leveldataengine.md` -- screen-exit format + level-header
  bit-packing.
- `docs/spritestateengine.md` -- 9-state sprite engine dispatch
  conventions.

External references:

- `yoshisisland-disassembly/disassembly/bank11.asm` (Raidenthequick) --
  has descriptive labels `init_mini_battle_gather_coins`,
  `init_mini_battle_pop_balloons_left/right`,
  `init_mini_battle_watermelon_spit`, `init_item_card`,
  `init_coin_cannon` etc. All have been adopted as aliases.
- `yoshisisland-disassembly/disassembly/bank05.asm` -- `init_bucket`,
  `main_bucket`, `main_bucket_obj`, `bucket_state_ptr`.

---

## 10. Open questions

The deep-read identified the following uncertainties worth a follow-up
trace pass:

**Q1. Slot-machine reel-value semantics on plain Bucket `$021`.** The
plain Bucket has a slot-machine display in state 0 (the four-state
`DATA_bucket_main_state_ptr` at `$05:C8AE`). The Init reads the
spawn-X bit 4 into `$16,x` (state-0 variant byte), and the spin in
state 0 cycles through some sub-frames. However, the **state-2 drop**
(`CODE_05C958`) does not read `$16,x` to pick what to drop -- it just
seeds X-velocity from `DATA_05C954 = $0200, $FF80` indexed by `$7862,x`
(a damage-flag). So either (a) the reel display is purely cosmetic and
nothing is dropped, or (b) the drop logic is elsewhere and my read
missed it. Verifying via emulation would clarify. Best guess: the
plain Bucket truly drops nothing useful; the slot-machine animation is
a red herring kept from a feature that didn't ship.

**Q2. The "jackpot" outcome semantics in the gather-coins mini-battle.**
The gather-coins win path at `CODE_11AE73` spawns an Item Card with
`$701978,y` randomly seeded from `DATA_11AE45 = $06, $04`. So the
**deterministic award is 6 lives or 4 lives** (offsets in the
extra-lives range). Does this mean the gather-coins mini-battle never
awards an actual item (slots 0-9)? Looks that way from the code, but
seems surprising given the visual variety of the cards. Worth checking
runtime behaviour.

**Q3. The Mock-Up `$08B` chase variant trigger.** The Init at
`$03:E8D0` jumps to state $0A (cleanup) if `$701900,x != 0`. This
means the variant byte being non-zero is a signal that the Mock-Up was
**spawned via the chase-respawn mechanism** (states $0C/$0E in the
phase ptr table). What is the originating spawn site? I couldn't find a
direct `LDA #$008B / JSL spawn_sprite_init` that pre-sets `$701900`;
the chase loop likely re-uses the original slot by clearing
`$CurrentStatus,x` and rewriting `$701900`. Would need to trace the
phase-$0E exit path.

**Q4. The bonus-game variant `$1170 = $03/$04/$05` semantics.** The
three bonus-game sub-modes (0/1/2 in `DATA_bandit_minigame_init_ptrs`)
all set `$1170 = Y` for Y `= $03/$04/$05` respectively, and the Item
Card prize index becomes `($1170 - $03) + $0A` = `$0A/$0B/$0C` = 1/2/3
extra lives. So each sub-mode awards a fixed number of lives. What
distinguishes the **visual presentation** of the three bonus-game
scenes? The dispatcher only diffs them via `$1170`, which feeds into
the BG-mode setup and the music ID table -- but functionally they all
go through `CODE_11810A`. The differing palettes at
`YI_Global_PaletteMirror[$C5]` are sub-mode-specific. Need to compare
the three scenes side-by-side.

**Q5. Watermelon-Pot `$1B8` "rotten" award semantics.** When `$1B8`
spawns sprite `$09` (the rotten watermelon variant), how does Yoshi's
side experience this differently? The pot's logic at `CODE_11C4B0`
counts up `$1110` (consecutive rotten counter) and forces non-rotten
after 3-in-a-row. But the *consumer* is the watermelon-seed-spit
mechanic in `$1B7` (or `$1B9`); does swallowing a rotten one have any
effect, or does it just fail to produce a seed?

**Q6. The 1up popup chain $22D/$22E differentiation.** The Bank00
AmbSpr handlers `CODE_ambient_main_bonus_1up_jackpot_head` ($22B) and
`CODE_ambient_main_bonus_1up_regular_head` ($22C) both spawn a tail --
$22B spawns `$22D` via `CODE_ambient_helper_spawn_bonus_1up_popup_tail`
at frame counter `$E`, while $22C spawns `$22E` at a Y-speed threshold
of `$0280`. What is the visual difference between $22D and $22E? Both
are "popup-letter tail" sprites but their Main bodies probably differ
in animation curve. Worth a quick look at Bank00's $22D/$22E Main.

**Q7. The `$011` Item Card Init double-SuperFX-kick V1.0 vs V1.1
divergence.** The Init at `$11:C8F0` ends with `BRA CODE_11C99D`
(skipping `CODE_11C954`), but on V1.1 the secondary kick at
`CODE_11C954` includes an extra `STA $REGISTER_SuperFX_R14` /
`LDA #(FXDATA_538000+$0070)>>16` / `STA $REGISTER_SuperFX_R12` pair
that V1.0 lacks. The conditional code at `if !Define_Global_ROMToAssemble&(!ROM_YI_U2) != $00`
suggests V1.1 fixes a bug where the second kick was incorrectly
configured. Need to confirm whether V1.0 ItemCard rendering visually
breaks under specific timings, or if `CODE_11C954` is unreachable
under V1.0 entirely (the `BRA` skips it).
