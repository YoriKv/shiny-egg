# YI Bowser-fight supporting cast reference

Standalone reference for the Yoshi's Island Bowser-fight supporting sprite
cluster -- the rocks, fire, rubble, giant egg, and Bowser-room Kamek that
coordinate with the Baby Bowser boss state machine. Companion to
`docs/bossengine.md` (which documents Baby Bowser himself at §7 +§10 Q3).

Eight sprites live in this cluster, all of them in Bank0D except the
Bowser-fight cloud which lives in Bank04. None of them have a Raidenthequick
descriptive label for the whole state machine, but most have one or two
anchor labels (`init_rubble`, `init_bowser_quake`, `init_baby_bowser_egg`,
`init_bowser_flame`, `init_bowser_room_kamek`). Cross-bank attribution
notes use bare filenames only -- see `ys_bbbros.asm` for the boss-bros
state machine and `ys_enmy*.asm` files for the per-sprite handler family.

Source of truth: `yi/Banks/Bank0D.asm` (Baby Bowser at line 8866, the
supporting cluster from ~11580 through end-of-bank at ~13520),
`yi/Banks/Bank04.asm` (Bowser-fight cloud at line 11570),
`yi/Constants/NormalSpriteIDs.asm` (annotated ID -> handler map).
Cross-checked against `yoshisisland-disassembly/disassembly/bank0d.asm`.

---

## 1. Cluster at a glance

| ID    | Name                        | Init / Main (Bank0D except where noted) | Role |
|-------|-----------------------------|-----------------------------------------|------|
| `$008` | FallingRubble              | 13432 / 13442                           | Cosmetic debris spawned by `$0CF` rock waves. Decrements `$1072`. |
| `$026` | BowserFightGiantEgg        | 13100 / 13113                           | The giant egg the player rides at fight end. Damage projectile + ride object. |
| `$083` | BowserFightCloud           | Bank04:11570 / 11584                    | Background cloud-platform drift. Pure cosmetic. |
| `$08E` | BowserRoomKamek            | 11580 / 11660                           | Casts the magic that transforms small Bowser into giant Bowser. |
| `$0AC` | FallingRockArrowAndShadow  | 13474 / 13484                           | Telegraph arrow + shadow for incoming giant-Bowser rocks. |
| `$0CE` | BowserFire                 | 13327 / 13371                           | Giant Bowser's fire-breath projectile. |
| `$0CF` | BowserRocks                | 12777 / 12868                           | The orchestrator: BG quake + multi-wave rubble + giant-rock spawner. |
| `$128` | GroundRippleInBabyBowerRoom| 12186 / 12196                           | Screen-shake / heat-distortion AND the giant-Bowser hitbox detector. |
| `$134` | BabyBowser                 | 8866  / 8926                            | The boss itself. **Documented in `docs/bossengine.md` §7.** |

The Bank0D header (lines 4-8) gives the canonical "eight-sprite back half
of the bank" view; this doc breaks each one down.

### 1.1 Phase-by-phase appearance

Baby Bowser's `DATA_baby_bowser_phase_ptrs` (Bank0D:8880, 39 entries) tells
the macro story; the supporting cast appears in phases roughly as follows.

| Bowser phase ($76,x)  | Supporting sprites alive                              |
|-----------------------|-------------------------------------------------------|
| `$00..$09` small Bowser intro / hop / chase | -- (claw form, no supports yet)              |
| `$0A..$11` small Bowser combat              | `$0CF` (rumble batch on first headstomp); a Kamek `$048` AmbientSprite is spawned at phase `$0E` via `$1015` handshake (Bank0D:9692-9697) |
| `$12..$15` Kamek-transform cinematic        | Bowser-room Kamek (`$08E`) runs its 10-state cinematic; tracks Bowser-slot at `$105E` |
| `$16..$22` giant-Bowser combat              | `$0CF` (rock cluster + cosmetic palette pulse), `$128` (per-footstep ripple), `$08E` Kamek watches, `$083` clouds drift, `$0AC` arrow + `$008` rubble during rock attack, `$0CE` fire breath, `$026` giant egg on player retaliation |
| `$23..$26` giant-Bowser death               | `$0CF` cleanup branch + `$013` (BossExplosion) spawned by main_baby_bowser |

The phase numbers above are gleaned from the pointer-table entries that
`JSR` into shared handlers vs Kamek-throw stubs at offsets `$13..$15`
(see Bank0D:8901-8903, which point at `CODE_0DEBAA / CODE_0DEBE7` --
i.e. Bowser delegates state $13/$15 to Kamek's state handlers).

### 1.2 Shared WRAM coordinator words

The cast does NOT pass arguments by registers between Init/Main calls --
state lives in 16-bit WRAM words readable by every sprite. Eight words
matter for the cluster.

| WRAM   | Owner / writer            | Readers                                   | Meaning |
|--------|---------------------------|-------------------------------------------|---------|
| `$1015` | Bowser phase $0E + Kamek `$048` | Bowser phase $0F (`BPL`)                  | **4-state Kamek spell handshake**. See `docs/bossengine.md §10 Q3`. Bowser-room Kamek (`$08E`) reuses the same protocol via its own state $07 -> $08 sequence. |
| `$1062` | Bowser state $0B (`INC $1062` Bank0D:9607)  | Bowser state $0B / $128 ripple-detect at 12317  | **Small-Bowser hit counter.** Reaches 3 -> Kamek-transform phase. |
| `$1068` | giant-Bowser camera init at 10441 | $128 ripple, `$026` egg, Mode7 setup at 11218 | **Giant-Bowser anchor X** (Mode-7 center). Decremented on death (10897). |
| `$106A` | same                       | same                                      | **Giant-Bowser anchor Y**. |
| `$106C` | same                       | same                                      | **Giant-Bowser depth / Z**. |
| `$1070` | `$0CF` Main (init 12790, walk 13023) | `$0CF` rock-cleanup branch (13012)        | **Rock-wave index**, walks `DATA_0DF609` (7 X-positions). |
| `$1072` | `$0CF` Init (12834), `$008` Main (13465) | Both `$0CF` Main + `$008` Main           | **Active-rubble counter.** Init seeds $1C or $3C; rubble decrements on despawn; Main idles while non-zero. |
| `$1074` | `$026` egg Main on impact (13231)  | giant-Bowser Mode-7 frame (11273)         | **Giant-Bowser hit-stagger flag.** Bowser polls each frame; non-zero -> jumps to hurt state $1E and clears. |
| `$1076` | giant-Bowser hurt path (11278)     | -- (paired with $1078 in some banks)      | **Giant-Bowser HP cumulative.** Each `$1074` -> $1076 +1. |
| `$105C` | Bowser-room Kamek state $09 (12150) | Kamek state $03 + $07 (11832, 12036)      | **Kamek "spell done" flag.** State $09 increments before exit-jump. |
| `$105E` | Bowser-room Kamek Init (11587, on `$0134` spawn) | `$128` ripple-hit detect (12292, 12301); Kamek states $06, $08, $09 (11930, 12039, 12060) | **Baby Bowser's normal-sprite slot index.** Kamek seeds it when spawning Bowser. |
| `$7B56,x` | `$026` egg Main (impact: 13208 reads, 13215 clears) | giant-Bowser uses to gate hit detection | **Per-egg "armed" flag.** Stops one egg from registering two hits. |

The `$1068/$106A/$106C` triplet is genuinely a Mode-7-style 3D anchor:
`$1068` doubles as the screen-X reference for the egg's flight path
(13193, 13207) and for the rock-attack arrow telegraphs.

---

## 2. Falling-rubble and Bowser-rocks system (`$0CF` + `$008` + `$0AC`)

The rock system is the most elaborate of the supports. It's split across
three sprites and uses two distinct attack modes (small-Bowser
"headstomp -> ceiling-tremor" cosmetic, and giant-Bowser
"telegraphed rock-drop"), with handoff via `$1070`, `$1072`, and `$0CF`'s
per-state byte at `$18,x`.

### 2.1 BowserRocks Init (`YI_NorSpr0CF_BowserRocks_Init`, Bank0D:12777)

1. **Pre-render 3 ceiling-rock graphics.** Loop runs `Y = $04, $02, $00`
   (3 iterations, step -2). Each pass loads a per-rock parameter triplet
   from `DATA_0DF625` (X-offset), `DATA_0DF62B` (scale), `DATA_0DF631`
   (orientation) and calls `FXCODE_088205` (the standard
   dyntile-batch-stamper) targeting `FXDATA_548000+$00E0`. Result: 3
   pre-stamped rock tiles ready for the per-frame OAM loop.
2. **Copy palette-pulse table.** `DATA_5FF4A0` (29 bytes, ROM-side) copies
   into `$702F2E` (GSU scratch) and into the palette mirror at
   `YI_Global_PaletteMirror[$E1].LowByte` plus `$7021C2` and `$70312E`.
   This is the rumble palette flash.
3. **Seed rubble counter `$1072`.** Compares NMI mode `$011C` to `#$02`
   (Map / non-fight mode) and to per-sprite `$701902` extra-info byte to
   pick `$1C` (28) or `$3C` (60) initial active-rubble units. Stored into
   both `$1072` (global) AND `$18,x` (per-slot rock-wave countdown).

After Init, the rocks sprite's `$0CF9` (sprite-render-queue head) has
been bumped 3 times -- 3 OAM entries already in flight.

### 2.2 BowserRocks Main, small-Bowser mode (`$1072 != 0` branch)

When the global rubble counter is non-zero, `main_bowser_quake`
(Bank0D:12868) enters the cosmetic-cascade path:

1. **Force quake.** `$14 & $000F | $0040` -> `$61C6` (X-shake timer) every
   frame.
2. **SFX cooldown via `$7AF6`.** Picks `BigExplosion` (`!Define_YI_SoundID99`)
   with a random cooldown from `DATA_0DF6FA` (`$40/$10/$50/$20` bytes).
3. **Spawn-rate gate.** `$7A96,x` is the per-spawn delay; `$10` frames
   in normal mode, `$08` in alternate (faster cascade). Each cycle, if
   `$18,x` (the per-slot rubble countdown) is nonzero, `JSL CODE_spawn_sprite_active`
   on sprite ID `$008` (FallingRubble) and configure the new slot:
   - Wave-mode selection: `$18,x & $000F` indexes into `DATA_0DF6B0`
     to pick one of 8 rock-shape pairs (positive/negative X-velocity +
     palette + animation frame).
   - Random X-spread from `DATA_0DF6D2` (16 entries, `$10 & $001E` index).
   - Y-velocity from `DATA_0DF6F6` ($D000 or $3000 -- ceiling-drop or
     up-rebound), Y-position from layer1-Y + `DATA_0DF6F2`.
4. **Decrement `$18,x`** until 0; then the active-rubble-counter `$1072`
   drains via despawning rubble (`$008` Main decrements on exit).

The whole loop ends when `$1072` reaches 0, at which point `$0CF` Main
falls through to the "giant rocks" branch (`CODE_0DF7C1`).

### 2.3 BowserRocks Main, giant-Bowser mode (`$1072 == 0` branch)

1. **Sub-state $00 (initial entry to giant mode):** Copies palette table
   `DATA_5FF4DC` (29 bytes) into pal-mirror at `$E1`, clears arrow shadow,
   seeds Y-position layer1-Y + `$F0`, sets `$18,x = $05` (5 giant
   rock-drops to come).

2. **Sub-state non-zero (per-rock-drop phase):**
   - Pumps an FXCODE_08877E call to render the multi-rock cluster.
   - Reads X-camera-offset (`$7682,x`) and checks `$1070` (rock-wave
     index) against `$0E` -- if reached, falls to `JML CODE_03A31E`
     (despawn).
   - Otherwise `$1070 += 2` and spawns:
     - **Position:** `DATA_0DF609` (7 entries, indexed by `$1070-2`)
       gives the wave's screen-X. Y always layer1-Y `-$200`.
     - **A telegraphing `$0AC` FallingRockArrowAndShadow** via
       `JSL CODE_spawn_sprite_active`. The arrow gets Y at `$07C0`
       (floor offset), wait-counter `$7A96 = $80` (frames of telegraph),
       and a derived `$701978` extra-info field from `$76,x` (the rock's
       width / vertical offset profile).
     - **Sound:** plays `SoaringEgg` SFX (`!Define_YI_SoundID20`) to
       cue the falling-rock incoming.

The `$1070` walk through `DATA_0DF609` is asymmetric (`$0180, $00F8,
$0060, $FFF0, $0128, $00A0, $0048`) -- the rocks come from spread positions
to cover the whole arena.

### 2.4 FallingRubble (`$008`)

Init is a bare `RTL`. Main (Bank0D:13442) is tiny:

```
1. Pump SuperFX render via CODE_0DFA94 (shared OAM helper, with
   $7041,x>>3 as palette-row argument).
2. Apply gravity via CODE_03AF23.
3. Check Y-speed sign: if going up & Y > $F600 -> persist; if going down
   & Y > $0700 -> persist; otherwise:
     DEC $1072  (decrement global active-rubble counter)
     JML CODE_03A31E  (despawn)
```

So rubble's only "intelligence" is gravity + screen-bounds + counter-decrement.

### 2.5 FallingRockArrowAndShadow (`$0AC`)

Init is bare `RTL`. Main (Bank0D:13484) is the telegraph timer:

- `$74A2,x` bit-7 set -> in "still arrowed" mode: flashes via `$0030 &
  $0008` bit-test, calls `CODE_02D995` (shared ambient-FX render).
- Otherwise applies SuperFX render + decrement `$7A96` (wait counter);
  when it expires `JML CODE_03A31E` (despawn -> the rock above lands).
- `$7402,x` ramps up to `$18,x` cap -- this is the **arrow growth /
  brightness over time** (the longer the telegraph, the bigger the arrow).
- Final state: `$74A2,x = $0004` (cleanup), then resume.

The `$0AC` lifetime is the player's window to dodge.

---

## 3. Giant egg (`$026`) -- the Bowser-fight projectile

`$026` is the egg-shape sprite that Yoshi launches at giant Bowser at the
end of the fight cinematic. Despite being in the egg-ID range, it is
**not** treated as a normal-egg by Bank07's egg-collision code: the
`CMP #!Define_YI_NorSpr026_BowserFightGiantEgg / BCS` checks at Bank07:3475,
3579, 3606, 3700 use `$026` as the **upper exclusive bound** of the
egg-class range $022..$025. So Bowser-egg is its own sprite class.

### 3.1 Init / spawn

`YI_NorSpr026_BowserFightGiantEgg_Init` (Bank0D:13100) is a bare `RTL`.
The egg's WRAM fields are preconfigured by whatever spawner produces it
(see `DATA_goal_award_giant_egg_trio` in Bank02:4547 for the "goal arc"
variant, which is the same sprite ID used for the 3-egg goal-pad
animation -- so `$026` doubles as the goal-pad demo egg too).

### 3.2 Main (Bank0D:13113) -- two-mode dispatcher

```
Main first reads $7D38,x:
  - If non-zero: standard "in flight + collision" handler (CODE_0DF903)
  - If zero:     "passive" path (CODE_0DFA74) -- runs CODE_03B9DD then
                 either CODE_03BB1D (ground egg) or stomp/cleanup
```

The active-flight path (`CODE_0DF903`) is the interesting bit:

1. **SuperFX-projected trajectory.** `CODE_0DFA94` shared helper feeds
   the egg's X/Y/scale into GSU R1/R2/R3 and runs `FXCODE_09F5F4` (the
   "rotate + project" routine). Then increments Y by R2 result and X by
   R1 result -- the egg follows a parabolic-rotated path.
2. **Below-ceiling test (`$7682,x < $FFC0`).** While the egg hasn't yet
   reached giant Bowser's vertical band, just keeps flying; once close,
   it transitions to "impact" mode.
3. **Impact branches.** Spawns `$091` 4-RedToadies (carry-off animation)
   or coins/stars via `CODE_make_star_or_coin_l`. Sets sprite-status to
   $0E ("dying-explosion"), seeds `$7540 = $0C, $7542 = $20` (hit-stop
   duration), sound `Clank7` or `HitMessageBox`.
4. **The damage handshake.** When `$1068 - R9 < 0` (egg is inside the
   giant-Bowser hit zone) and `$7B56,x` not yet set, runs an oblique
   intersection test against `$106C - $1068` (depth) and `$7CD8,x - $106A`
   (Y) -- if both pass, **`INC $1074`** (giant-Bowser hit-stagger flag).
   On the very next frame the giant-Bowser handler (Bank0D:11273) sees
   `$1074 != 0`, sets `$76,x = $1E` (hurt state), increments `$1076`
   (HP cumulative), plays `BowserHurt`, and clears `$1074`.
5. **Per-egg arming via `$7B56`.** Only one impact per egg flight --
   set on first hit, cleared by Bowser's hurt handler.

### 3.3 Player-state lock during egg cinematic

Look at `CODE_04DB68` (Bank04:11619), the **player-state remap** that
runs during the Bowser ride. `DATA_04DB52` is an 11-entry remap table
indexed by the player's current `!EXRAM_YI_Player_CurrentStateLo`. All
of states $01..$09 map to player-state $06 (mounted / riding) and state
$0A remaps to `PlayerState20_EnteringRaphaelBossRoom`. The boss-mount
also force-freezes sprites via the `!EXRAM_YI_Level_FreezeSpritesFlagLo`
write at 11630.

So the egg's "I'm riding it" state transfer is: enter cinematic ->
remap player state to $06 -> freeze sprites -> hand off control to the
egg slot's Mode-7 flight path.

---

## 4. Bowser fire (`$0CE`)

`YI_NorSpr0CE_BowserFire_Init` (Bank0D:13327) is more substantial than
the others:

```
1. JSL CODE_03AEEB (standard sprite-init prologue).
2. $74A2 = $0007  (hitbox-size / damage class)
3. $7402 = $0008  (lifetime / animation frame counter)
4. CODE_0DFAD2 (per-frame helper, also called from Main):
   - R5 = $18,x   (angle accumulator low byte)
   - R6 = $76,x - $00AB (state-relative angle offset)
   - If R6 >= $0400: clear $7402 (kill-on-impact) and reset $7040 = $0003
   - R3/R2 = camera anchors from sprite's $7722 (chain-index)
   - R12/R13 = FXDATA_548000+$00C0 (fire palette block)
   - JSL into FXCODE_0888AC (the fireball-render kernel)
5. $0CF9 += 1 (bump OAM queue head)
```

`YI_NorSpr0CE_BowserFire_Main` (Bank0D:13371) drives motion + damage:

1. **Trajectory pump.** Calls `CODE_0DFA94` with magnitude $0020 (fast)
   or $0004 (slow) depending on `$7402,x`. Runs `FXCODE_09F70B` (the
   line-of-sight / collision-probe kernel) -- if R0 returns 0, calls
   `CODE_03A858` (hit-Yoshi handler).
2. **Despawn condition.** R9 (depth) >= `$0100`, fire `JML CODE_03A31E`.
3. **Wave drift physics.** `$7A36/$7A38` is a 16-bit signed accumulator
   driven by `$16,x` (drift coefficient). Each frame:
   - `$7A36 += $16` (low byte of velocity integrator)
   - `$7A38` carry-adds with sign extension
   - The integrated displacement is written to `$701902` AND `$70E2`
     (X-position) directly: the fireball gradually waves laterally
     while flying forward.

So fire travels in a curving line with the sign-extended integrator
giving it the characteristic side-to-side wave.

### 4.1 Fire spawn site

Giant-Bowser's "fire-breath" attack state spawns it from
`CODE_0DD822` (Bank0D:10773):

```
LDA #!Define_YI_SoundID10_ShellHit6 / JSL push_sound_queue
LDA #$0010 / JSR CODE_0DD7A2  (spawn ambient flash)
... stash $70A2,y in $00, $7142,y in $02 ...
LDA #$00CE / JSL CODE_spawn_sprite_init   ;; ** the fire spawn **
... seed via $1068/$106A/$106C anchors ...
```

The new fire's `$701902` (X-anchor) is `$106C - $0008 + $1068 - $0100`
(diagonal from giant Bowser's mouth), Y is `$106A - $0050`, and the
SuperFX projection (`FXCODE_09907C`) is run twice -- once per axis --
to compute the initial velocity components that get stored into
`$16,x` and `$701902,x` for the X half, then `$70xx,x` for the Y half.
This is the "aim at Yoshi" calculation in projected-3D space.

---

## 5. Bowser-room Kamek (`$08E`)

Kamek's role in the Bowser fight is **both** to cast the giant-transform
spell AND to act as the "watch from upper-left" boss-spectator. Same
sprite ID handles both phases via the 10-entry
`DATA_bowser_room_kamek_state_ptrs` (Bank0D:11644).

### 5.1 Init choreography

`YI_NorSpr08E_BowserRoomKamek_Init` (Bank0D:11580) does:

1. **`$7E1A = $0080`** (sprite-spawn-buffer pointer reset).
2. **Spawn Baby Bowser via `$0134`**:
   ```
   LDA #$0134 / JSL spawn_sprite_active
   STY $105E              ; cache Bowser's slot index globally
   STZ $105C              ; reset "spell done" flag
   ```
3. **First-visit vs revisit branch on `BabyBowerHasBeenVisitedBeforeFlag`**:
   - **First visit** (flag = 0): seeds Kamek's slot for the "approach
     from offscreen" cinematic. Sets `$70E2,y = $0150` (offscreen X),
     `$7182,y = $077D` (mid-room Y), spawns the `$7019D8 = $000A`
     enter-walk timer + `$7019D6 = $0012` initial state. Calls
     `CODE_029507` (camera-lock cinematic init). Falls through to
     state $00 of the per-frame dispatcher.
   - **Revisit** (flag = 1): WRITES POST-TRANSFORM PALETTES DIRECTLY
     into Bowser's slot at sprite-PRAM `$702F2E / $702E2E / $702E4E`,
     skips the entire intro cinematic, and `JML CODE_03A31E` --
     despawning Kamek immediately. Bowser jumps straight into giant
     phase. The 28-byte palette payloads come from `DATA_5FEA3C` (post-
     transform fur), `DATA_5FEA00` (face), `DATA_5FEA1E` (shell), with
     identical mirrors copied into the in-RAM palette buffer.

The revisit case is the **save-state shortcut**: dying to giant Bowser
and respawning skips the intro. This is the only sprite in the game
that conditionally short-circuits its own intro based on a save-flag.

### 5.2 Per-frame dispatch (`YI_NorSpr08E_BowserRoomKamek_Main`, Bank0D:11660)

Standard `$76,x` state-machine pattern. The 10 entries are:

| state | label             | role |
|-------|-------------------|------|
| $00   | CODE_0DEBAA       | approach: wait for player to enter zone (X >= $0060), lock camera |
| $01   | CODE_0DEBE7       | spawn message box ($0111 or $0114 depending on revisit) |
| $02   | CODE_0DEC74       | first dialogue: walk per-frame anim via DATA_0DEC24 (frame) + DATA_0DEC4C (timing) |
| $03   | CODE_0DECE2       | swap Bowser's palettes via FXCODE_08B4A9 -- the on-screen color shift |
| $04   | CODE_0DED47       | move Kamek to "throw position" + show second message |
| $05   | CODE_0DEDAC       | second dialogue (separate anim tables DATA_0DED7A / DATA_0DED93) |
| $06   | CODE_0DEE00       | throw cinematic: spawn `$1F1` ambient sprite for magic-dust trails |
| $07   | CODE_0DEEAB       | wait for spell projectile to land on Bowser; spawn ambient |
| $08   | CODE_0DEEEC       | Kamek-leaves-flying animation (negative X-vel + Y-vel) |
| $09   | CODE_0DEFF1       | fly-off + INC $105C (spell-done flag) + despawn |

### 5.3 The `$105C / $105E` handshake (not `$1015`!)

Bowser-room Kamek does **not** reuse the `$1015` channel that `docs/bossengine.md
§10 Q3` documents for the AmbientSpriteKamek (`$048`) flow. Instead it
uses a dedicated pair:

- **`$105E`** = Baby Bowser's slot index (written once at Init, read by
  Kamek states $06 / $08 / $09 to position the magic-dust spawn relative
  to Bowser).
- **`$105C`** = "Kamek-spell done" flag (set by Kamek state $09 just
  before its own despawn; polled by Bowser to advance phase).

This is the same architectural pattern as the `$1015` handshake -- a
shared word polled by both ends -- but a different channel because the
two Kamek variants share neither AmbientSprite-slot space nor
NormalSprite-slot space (Bowser-room Kamek is `$08E`, a NormalSprite;
the `$048` cutscene Kamek is an AmbientSprite). The fact that
`$1015` is *also* `INC`-ed at Bowser phase $0E (Bank0D:9697) is for
the cutscene-Kamek path -- the small-Bowser hop calls that channel
INDEPENDENTLY of the room-Kamek's $105C/$105E channel. Both protocols
run concurrently during phases $0E..$15.

Worth pinning here: `$105C/$105E` is unique to this fight and does
not appear in any other boss bank.

### 5.4 The pre-Bowser SuperFX palette swap

State $03 (`CODE_0DECE2`, Bank0D:11810) is the key visual moment.
Reads `$70336C` (GSU-side scratch, incremented per-frame by the helper):
- If `$70336C >= $0020` (cooldown elapsed): exits state $03 normally,
  jumps to state $04.
- Otherwise: configures `FXCODE_08B4A9` source = `$2D6C` (current palette
  table), dest = `$2F6C` (post-transform palette table), and runs it.
  This is the **per-frame palette blend** -- the visible "Bowser
  transforming" gradient.

The same `FXCODE_08B4A9` palette-cross-fade kernel is re-used by state
$06 + $07 for the magic-dust palette flash; it's a generic
linear-interp-between-two-palette-tables routine.

---

## 6. Background sprite: Bowser-fight cloud (`$083`)

`YI_NorSpr083_BowserFightCloud_Init` (Bank04:11570):
```
$74A1,x = $02     ; render priority 2 (behind boss, in front of BG)
RTL
```

That's it. The cloud is preconfigured by its spawner (which lives in
`CODE_0DD57E` -- the giant-Bowser-room-init sequence at Bank0D:10465)
where it gets `$74A1 = $06`, sprite-frame `$2001` or `$F801`, X+Y from
`$1068/$106A + DATA_0DD4A0/A4` offsets per cloud.

`YI_NorSpr083_BowserFightCloud_Main` (Bank04:11584) drift:
```
1. JSL CODE_03AF23 (standard sprite-physics shared)
2. If $7680,x (camera offset) < $0130: skip drift this frame
3. Otherwise:
   Y = $10 & $0006  (4-cycle phase)
   $70E2,x = layer2-X - DATA_04DB23[Y]   ; DATA = $0030, $0040, $0050, $0060
   ;; i.e. cloud sits behind layer2 with a phase-cycled offset
4. RTL
```

So clouds drift relative to layer2-scrolling with a tiny 4-frame
parallax cycle. Pure cosmetic. The shadows / damage of the boss arena
are NOT routed through the cloud sprite.

---

## 7. Ground ripple (`$128`) -- the secret damage detector

This sprite deserves its own section because it's the bridge between
the "egg hits ground" cosmetic and the giant-Bowser hit-stagger.

`YI_NorSpr128_GroundRippleInBabyBowerRoom_Init` (Bank0D:12186) is a
bare `RTL`. The Main routine (12196) chains 5 helper functions:

```
JSR CODE_0DF058   ; render ripple via FXCODE_0B96EA (wave-distortion)
JSL CODE_03AF23   ; gravity / position pump
JSR CODE_0DF082   ; advance amplitude $78,x toward $0A00 cap
JSR CODE_0DF0A3   ; despawn if $7D36 < 0 (offscreen) AND $7AF8 == 0
JSR CODE_0DF0B9   ; *** the giant-Bowser collision probe ***
JSR CODE_0DF182   ; (additional cleanup)
RTL
```

`CODE_0DF0B9` is the key (Bank0D:12269):

1. Reads `$7AF6,x` (probe cooldown); skips if non-zero.
2. Calls `FXCODE_099011` (the slot-list-walk + intersection-test kernel)
   -- this returns `Y = sprite slot index` of whatever the ripple
   touched, or negative if none.
3. **Branch on `Y == $105E`** (Bowser's slot):
   - YES -> check `$7019D6,y >= $0009` (Bowser is in valid state),
     and `$Y_speed,y >= 0` (he's landing), then knock him with X-vel
     from `DATA_0DF0B5[$7400,x]` (`$FE80` or `$0180`), Y-vel `$FA00`,
     `$7542,y = $0040` (hit-stun), `$7A36,y = $0047` (anim frame),
     `$7019D6,y = $000A` (new sub-state). Sound: `BabyBowserHurt`
     or `BabyBowserDefeated` based on `$1062 >= 2`.
4. **Otherwise** (touched some other sprite): if it's another `$128`
   ripple, EOR-test their X-velocity signs to handle wave-merge; if
   different signs and they're approaching, merge their amplitudes.

So the ripple is a **physical damage carrier** -- the small-Bowser fight
delivers damage by spawning a ripple at the headstomp landing point,
the ripple walks toward Bowser, and on collision `FXCODE_099011`
identifies him via `$105E` slot-equality and applies velocity/sound.

This is unusual in the YI bosses. Hookbill, Naval Piranha, etc. detect
egg/headstomp hits directly inside the boss Main routine. Baby Bowser
delegates to a separate sprite that propagates physically through
SuperFX space. The advantage: the ripple respects camera position
naturally because it's a normal sprite, and the giant Bowser is too big
to use the standard `$78xx` collision pair.

---

## 8. Cross-references

- **`docs/bossengine.md`**
  - §1.5 -- boss state-machine conventions
  - §7 (table at line 605-631) -- Baby Bowser + this entire support cast indexed
  - §10 Q3 -- the `$1015` Kamek spell handshake (separate from `$105C/$105E`)
- **`docs/spritestateengine.md`** -- Bank03 NorSpr dispatch model (all these sprites flow through it)
- **`yi/Constants/NormalSpriteIDs.asm`** -- annotated handler addresses (line 28 `$008`, 58 `$026`, 157 `$083`, 168 `$08E`, 198 `$0AC`, 232 `$0CA`, 236 `$0CE`, 237 `$0CF`, 326 `$128`, 338 `$134`)
- **`yi/Banks/Bank0D.asm`** -- the entire cluster in one file (8 sprites span lines 8866-13498 plus a few earlier helpers); descriptive aliases follow each anchor label
- **`yi/Banks/Bank04.asm`** -- `$083` BowserFightCloud (11570) and `CODE_04DB68` player-state remap (11619)
- **`yi/Banks/Bank07.asm`** -- `$026` upper-bound checks at egg-collision sites (3475, 3579, 3606, 3700) showing `$026` falls outside the egg-class range
- **External**:
  - `yoshisisland-disassembly/disassembly/bank0d.asm` -- Raidenthequick's V1.0 disassembly with descriptive `init_*` / `main_*` aliases for most of these handlers
  - `ys_bbbros.asm` -- per-sprite boss-bros (Baby Bowser) handler reference
  - `ys_enmy*.asm` -- enemy/sprite handlers, partitioned by ID range

---

## 9. Open questions

1. **Egg-flight `$7B56,x` semantics across multiple eggs.** `$026` Main
   uses `$7B56,x` as a per-slot "hit registered" flag, but if Yoshi
   throws three eggs in rapid succession, all three flags need to clear
   independently. The hurt handler at Bank0D:11288 only `STZ $1074`,
   not the per-slot `$7B56,x`. Worth a runtime probe to confirm
   multi-hit-per-state behaviour.

2. **`$105E` aliasing.** Bowser-room Kamek caches Bowser's slot index
   in `$105E` at Init. If Bowser despawns and re-spawns (unlikely
   but possible during cinematic re-entry), `$105E` would point at a
   stale slot. The ripple `$128`'s damage check assumes `$105E` is
   live -- worth verifying revisit safety.

3. **`DATA_0DF609` 7-entry vs 5 giant-rock cap.** The rock-position table
   has 7 entries but `$18,x` is seeded `= $05` in the giant-mode branch
   of `$0CF` Init (so only 5 of the 7 positions are walked per run).
   Unclear whether the leftover entries are dead code or fallback for a
   different difficulty / rom-version path.

4. **`$0CF` palette pulse `DATA_5FF4A0` vs cleanup `DATA_5FF4DC`.** Two
   different 29-byte tables -- `DATA_5FF4A0` for the rumble pulse during
   small-Bowser phase, `DATA_5FF4DC` for the giant-Bowser cleanup
   palette. Easy to confirm by visualising in BizHawk during a run.

5. **`$083` cloud sprite count.** `CODE_0DD57E` (Bank0D:10465) spawns
   in a loop `LDX #$02 / DEX / DEX / BPL` -- so 3 clouds total per run.
   But `$74A1` priority is set on only one of them (the index-0 case
   at 10481-10484). The other two render at default priority. Cosmetic
   detail to confirm visually.
