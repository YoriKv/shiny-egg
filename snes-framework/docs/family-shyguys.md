# YI Shy Guy family reference

Standalone reference for the Yoshi's Island Shy Guy sprite family -- the most
common enemy in the game. Companion to `docs/spritestateengine.md` (the
underlying per-sprite engine the whole family rides on) and `docs/leveldataengine.md`
(how slots are populated from level data).

The family is unusually large: 30+ sprite IDs across roughly 8 banks, with
shared state machines, shared Init/Main bodies, palette-modulated color
variants, and several specialty enemies that just borrow the basic walker
shape with a single behaviour override. This doc catalogues them all,
explains the shared 9-state machine the canonical walker runs, and documents
the DP-mod (pixel-position-derived) variant-encoding mechanism the family
uses for colors and sub-types.

Source of truth: framework asm. Specifically:

- `yi/Banks/Bank04.asm` -- canonical walker $01E, Bandit-Trap $12A, Lantern
  Ghost $133, Stretch $124, Mace Guy $09B, Mufti / Petal Guy $192.
- `yi/Banks/Bank02.asm` -- Giant Shy Guys $043/$044.
- `yi/Banks/Bank07.asm` -- Stilt Guy $0F2, Slugger $0F5, Spear Guys $0FB/$0FC,
  Zeus Guy $0FD, Zeus Blast $0FE, Snifit $113, Snifit Bullet $114, Green
  Glove $11A, Fat Guy $12B, Walking/Running Grunt $159/$15A, Dancing Spear
  Guy $15B.
- `yi/Banks/Bank05.asm` -- Flamer Guys $0EC/$0ED.
- `yi/Banks/Bank0C.asm` -- Boo Guy $19A, Train Bandit $072, Woozy Guy $0F3,
  Roger pushers $047.
- `yi/Banks/Bank0D.asm` -- Boo Guys carrying bomb $105/$106.
- `yi/Banks/Bank03.asm` -- Flyguy $08D.
- `yi/Routines/ROUTINE_YI_NorSpr0AA_BackgroundShyguy.asm` -- Background
  Shy Guy $0AA (emitted into Bank00 / Bank0F in its own ROUTINE macro).

Cross-verified against `yoshisisland-disassembly/disassembly/bank04.asm` etc.
(Raidenthequick descriptive labels) and `ys_enmy.asm` / `ys_enmy2.asm` /
`ys_enmy3.asm` (parallel engine source, used to cross-check state semantics
and the family taxonomy).

---

## 1. Family at a glance

### 1.1 ID table

| ID | Name | Init handler | Main handler | Notes |
|---|---|---|---|---|
| `$01E` | Shyguy (canonical) | `init_shy_guy` Bank04:1406 | `main_shy_guy` Bank04:1502 | The shared 9-state walker. 4 palette variants via DP-mod. |
| `$043` | Red Giant Shyguy | `CODE_init_giant_shyguy` Bank02:8756 | `main_giant_shyguy` Bank02:8784 | Mini-boss; stomp-swallow. |
| `$044` | Green Giant Shyguy | (shared with $043) | `main_giant_shyguy` Bank02:8783 | Mini-boss; stomp-swallow. |
| `$047` | Shy Guy pushing Roger | `init` Bank0C:12958 | `main` Bank0C:13013 | Pair-pusher of the Roger ghost pot. |
| `$072` | Train Bandit | `init` Bank0C:14363 | `main` Bank0C:14386 | Chalk Shy Guy attacking train-Yoshi. |
| `$08D` | Flyguy | `init_flyguy` Bank03:14227 | `main_flyguy` Bank03:14273 | Balloon-carrier; 4 color variants. |
| `$09B` | Mace Guy | `init_mace_guy` Bank04:10356 | `main_mace_guy` Bank04:10393 | Spawns child mace $09C; reverts to $01E on stun. |
| `$0AA` | Background Shyguy | `init_background_shyguy` ROUTINE | `main_background_shyguy` ROUTINE | BG2-anchored parallax walker. |
| `$0EC` | Jumping Flamer Guy | `init_flamer_guy` Bank05:8542 | `main_flamer_guy` Bank05:8584 | Shared 7-state with $0ED; reverts to $01E. |
| `$0ED` | Running Flamer Guy | (shared with $0EC) | (shared with $0EC) | Shared 7-state with $0EC; reverts to $01E. |
| `$0F2` | Shyguy On Stilts | `init_stilt_guy` Bank07:728 | `main_stilt_guy` Bank07:775 | 2-state; stomp drops the stilts. |
| `$0F3` | Woozy Guy | `init` Bank0C:15533 | `main` Bank0C:15616 | Dizzy walker on wavy floor. |
| `$0F5` | Slugger | `init_slugger` Bank07:1148 | `main_slugger` Bank07:1178 | Egg-deflecting baseball Shy Guy. |
| `$0FB` | Long Spear Guy | `init_spear_guy_long` Bank07:2073 | `main_spear_guy` Bank07:2143 | Long-reach spear stab. |
| `$0FC` | Short Spear Guy | `init_spear_guy_short` Bank07:2085 | (shared with $0FB) | Short-reach spear stab. |
| `$0FD` | Zeus Guy | `CODE_init_zeus_guy` Bank07:9854 | `main_zeus_guy` Bank07:9876 | Masked lightning-blast thrower. |
| `$0FE` | Zeus Guy Blast | `init_zeus_guy_blast` Bank07:11097 | `main_zeus_guy_blast` Bank07:11116 | Tracking lightning projectile. |
| `$103` | Boo Guys' Moving Mace | `init` Bank04:11394 | `main` Bank04:11406 | Mace tossed between two Boo Guys. |
| `$105` | Boo Guys carrying bomb (left) | `init_boo_guys_carrying_bombs_left` Bank0D:485 | shared `main_boo_guys_carrying_bombs` Bank0D:674 | 3-state shared rope-bomb path. |
| `$106` | Boo Guys carrying bomb (right) | `init_boo_guys_carrying_bombs_right` Bank0D:495 | (shared with $105) | Mirror of $105. |
| `$113` | Snifit | `CODE_init_snifit` Bank07:2555 | `main_snifit` Bank07:2573 | Bubble snorter; spawns $114. |
| `$114` | Snifit Bullet | `init_snifit_bullet` Bank07:2765 | `main_snifit_bullet` Bank07:2780 | Snifit's bubble projectile. |
| `$11A` | Green Glove | `init_green_glove` Bank07:4039 | `main_green_glove` Bank07:4055 | Egg-juggling Shy Guy. |
| `$124` | Stretch | `init_stretch` Bank04:2372 | `main_stretch` Bank04:2424 | Elastic neck; 7-state, shares states 0/1 with $01E. |
| `$12A` | Shy Guy Bandit Trap | `init_shy_guy_bandit_trap` Bank04:1382 | (shared with $01E) | Pre-armed at sub-state $05; forces level-exit. |
| `$12B` | Fat Guy | `init_fat_guy` Bank07:5729 | `main_fat_guy` Bank07:5803 | 2-variant (small/big) bouncer; 4-state. |
| `$133` | Lantern Ghost | (shared with $01E) | (shared with $01E) | Pure tile/palette variant of $01E. |
| `$153` | Goonie with Shy Guy | `init_goonie_with_shyguy` Bank0E:2631 | shared goonie main | Goonie carrier; drops a $01E. |
| `$159` | Walking Grunt | `init_grunt_walking` Bank07:8834 | `main_grunt_walking` Bank07:8875 | Spike-hat ledge-jumper. |
| `$15A` | Running Grunt | `init_grunt_running` Bank07:8856 | `main_grunt_running` Bank07:8891 | Faster variant of $159; shared state table. |
| `$15B` | Dancing Spear Guy | `init_spear_guy_dancing` Bank07:9201 | `main_spear_guy_dancing` Bank07:9252 | Two 9-state dispatch tables (with/without conductor). |
| `$173` | BVZ carrying Shy Guy | -- | -- | Releases a $01E on pop (Baron Von Zeppelin payload). |
| `$176` | BVZ carrying Bandit | -- | -- | Releases a coin-thief Shy Guy variant. |
| `$192` | Petal Guy (Mufti Guy) | `init_mufti_guy` Bank04:2842 | `main_mufti_guy` Bank04:2863 | Flower-disguised Shy Guy. |
| `$19A` | Boo Guy | `init_boo_guy` Bank0C:1540 | `main_boo_guy` Bank0C:1582 | Sheet-ghost variant; 6-state idle/chase. |

(Additional family-adjacent sprites: $0CD/$0CE/$0CF Baron Von Zeppelin
variants, Caged-Ghost spitters $010/$193 that emit Shy Guys, the
"$155 Fat Goonie" that drops a Shy Guy. These are catalogued in their
own families and only touched here when relevant.)

### 1.2 Subfamilies

For navigation, the family clusters into seven sub-groups:

1. **Walkers** -- the shared 9-state machine path: `$01E`, `$133` Lantern
   Ghost, `$12A` Bandit Trap, `$124` Stretch (extends the machine to 7 states).
2. **Specialty hunters** -- borrow the walker shape with one new behaviour:
   `$0F2` Stilt, `$0F5` Slugger, `$0FB/$0FC` Spear Guy, `$0FD` Zeus Guy,
   `$0FB...` etc., `$159/$15A` Grunt, `$15B` Dancing Spear Guy, `$192` Petal
   / Mufti Guy.
3. **Disguises and conversions** -- start as one thing, become a `$01E`:
   `$09B` Mace Guy (revert on stun), `$0EC/$0ED` Flamer Guy (revert via
   `spawn_sprite` call), `$192` Petal Guy (burst-and-replace), `$155` Fat
   Goonie (drops on hit), `$0AB` Boo Balloon (drops on pop).
4. **Carriers and droppers** -- not Shy Guys themselves but Shy-Guy
   spawners: `$08D` Flyguy, `$153` Goonie-with-ShyGuy, `$173`/`$176` BVZ
   variants, `$0AB` Boo Balloon, `$1AE` Magic Shot.
5. **Boss-grade Shy Guys** -- `$043` Red Giant + `$044` Green Giant
   mini-bosses, with custom Main handler in Bank02.
6. **Ghost-coded Shy Guys** -- Boo-themed variants: `$19A` Boo Guy,
   `$105/$106` Boo Guys Carrying Bomb, `$103` Boo Guys' Moving Mace.
7. **Backgrounds and decorations** -- `$0AA` Background Shyguy (BG2 plane
   walker; pure cosmetic), `$0F3` Woozy Guy (cosmetic walk on the wavy
   floor effect, no projectile).

### 1.3 Common traits

- **Palette-modulated**: when the family doesn't have a hardcoded palette,
  the variant index is derived from the spawn pixel position
  (see section 3).
- **Reuse the 9-state machine**: the four "core walkers" ($01E, $12A,
  $124, $133) share `DATA_shy_guy_state_ptr` at Bank04:1473. Specialty
  enemies build their own state tables but still feed through the same
  engine-side state byte ($02 init / $10 main / $08 tongued / $0E head-bop).
- **Tongue-eat path**: most family members are edible. Their on-tongue
  behaviour is the engine default (`spr_state_tongued` in Bank03) which
  feeds them into the swallow-mouth bulge animation; the eaten sprite ID
  determines whether it produces a regular egg, fire breath, or seeds.
  See `docs/spritestateengine.md` section 5.3.
- **Stomp-bop converts to "explode into stars"**: the core walker's
  StompRt arms a 1-frame despawn timer and jumps to `CODE_head_bop_common`
  (the engine's shared head-bop body). Specialty variants either alias to
  that or override with their own knockback path.

---

## 2. Shared 9-state machine (DATA_shy_guy_state_ptr)

The canonical walker $01E shares its complete Init+Main+StompRt with $12A
Bandit Trap and $133 Lantern Ghost via shared label aliases at the same
addresses:

```
YI_NorSpr01E_Shyguy_Init:
YI_NorSpr133_LanternGhost_Init:
init_shy_guy:                                ; Bank04:1404-1406, addr $04:89C0
```

```
YI_NorSpr01E_Shyguy_Main:
YI_NorSpr12A_ShyGuyBanditTrap_Main:
YI_NorSpr133_LanternGhost_Main:
main_shy_guy:                                ; Bank04:1499-1502, addr $04:8A58
```

`$12A` has a different Init (it pre-seeds sub-state $05 to land directly
in the trap-dispense branch). Lantern Ghost has the same Init body but
differs only in tile/palette selection inside Main (`CMP #SpriteID`
branches at Bank04:1760-1764, 1820-1824, 2277-2281).

### 2.1 The 9 entries of `DATA_shy_guy_state_ptr`

Bank04:1473-1482. The state index lives at `$76,x` (a generic per-slot
byte; **distinct from** the engine state byte at
`!EXRAM_YI_Level_NorSpr_CurrentStatus|!EXRAMBankMirror,x`).

| `$76,x` | Handler | Address | Behaviour |
|---|---|---|---|
| `$00` | `CODE_shy_guy_state_00_walk` | Bank04:1921 ($04:8DA0) | Walk on ground. Selects facing-based X-speed, primes anim, transitions to $01 turn or stays walking. |
| `$01` | `CODE_shy_guy_state_01_turn` | Bank04:1978 ($04:8E14) | Turn / wall-bump. Picks a turn-around delay, rotates animation frame, transitions back to $00. |
| `$02` | `CODE_shy_guy_state_02_stunned` | Bank04:2060 ($04:8EB5) | Stunned post-hit. Issues SuperFX dyntile redraw to show the squashed-recoil sprite. |
| `$03` | `CODE_shy_guy_state_03_airborne` | Bank04:2103 ($04:8F0F) | Airborne / falling. On ground re-contact, transitions back to $00 via `CODE_048E90`. |
| `$04` | `CODE_shy_guy_state_04_in_mouth` | Bank04:2115 ($04:8F22) | Held in Yoshi's mouth. Runs swallow timer (cycles 8-frame ticks via $7A96 + $16 counter). |
| `$05` | `CODE_shy_guy_state_05_stub` | Bank04:56 ($04:8038) | Trap-trigger stub: a single `TYX / RTS`. Lives at the top of Bank04 since the dispatch trampoline does `TYX` to restore X before returning. Reached by `$12A` Bandit Trap Init pre-seeding $76 = $05. |
| `$06` | `CODE_shy_guy_state_06_emerge` | Bank04:2145 ($04:8F57) | **Emerging child.** Squeezes a shy guy out of a bandit trap **or out of a pipe** (the $08 pipe generator seeds its spawned child at $76 = $06). Cycles $7A98 timer, sets YSpeed to spit upward, transitions to $07 pop-out, plays `SoundID77_EnemyJumpingOutOfPipe`. |
| `$07` | `CODE_shy_guy_state_07_pop_out` | Bank04:2175 ($04:8F90) | Pop-out animation post-dispense (trap or pipe). Selects post-spit X-speed from `DATA_048F8C`, re-probes the pipe tile via `CODE_0EB8B7`, finally re-zeros $76 to walk. |
| `$08` | `CODE_shy_guy_state_08_pipe_generator` | Bank04:2208 ($04:8FD0) | **Pipe generator** (renamed from the misleading `..._collide_player`). Seeded by `init_shy_guy` when the sprite spawned on a pipe tile (see §2.4). Each tick: if Yoshi is in range (`$7C16`/`$7C18` deltas < `$38`/`$42`) and fewer than 7 family enemies are live (`FXCODE_099204` population count), spawn a child copy that emerges from the pipe (child -> $76 = $06), play `SoundID76_EnemyPeekingOutOfPipe`, then arm a `$7A96 = $C0` cooldown. **It IS reached via dispatch** -- the `CPY #$08 / BEQ` only skips the per-slot pre-dispatch physics, not the table call. (The `$7E48 = $FFFF` bandit-grab cinematic is an unrelated routine, `ride_bandit_shyguy` / `CODE_04909B`.) |

### 2.2 Dispatch entry

`main_shy_guy` (Bank04:1502 onward) flows:

```
LDY $76,x
CPY #$08                   ; $08 (pipe generator) skips the per-slot physics...
BEQ skip_physics           ; ...but STILL falls through to the dispatch below
JSR CODE_048ACB            ; per-slot SuperFX tile/oam refresh
LDY $76,x
CPY #$02                   ; if in stun state, gate on freeze/mosaic/item
BNE skip_physics
... (freeze/item gating) ...

skip_physics:
JSL CODE_03AF23
LDY $76,x
TYA
ASL                        ; index *= 2
TXY
TAX                        ; move slot into Y, dispatch index into X
JSR (DATA_shy_guy_state_ptr,x)  ; dispatch -- reached by ALL $76 values, incl. $08
LDY $76,x
CPY #$08
BEQ done                   ; $08 also skips the post-dispatch animation refresh
... (post-dispatch animation refresh + ground-stuck check) ...
RTL
```

Each state handler starts with `TYX` to restore X (because the dispatch
puts the slot in Y while indexing through the pointer table). The
"trap-trigger stub" at $05 is just `TYX / RTS` -- it exists only so the
$76 byte can sit there idle while waiting for Yoshi-touch.

### 2.3 Transitions

```
spawn OFF a pipe     -> $76 = $00 (walk)            ; init_shy_guy default
spawn ON a pipe      -> $76 = $08 (pipe generator)  ; init_shy_guy's CODE_0EB8AE check (§2.4)

ground walk          -> $00 (walk) <-> $01 (turn)                <- main cycle
hit by egg           -> $02 (stunned, post-hit recoil)
fall off ledge       -> $03 (airborne) -> $00 when landed

tongued by Yoshi     -> CurrentStatus = $08 (engine state -- NOT the $76 sub-state)
                          -> mouth path = $76 set to $04 by CODE_048CB2 area
                          -> $04 (in_mouth): wait for spit/swallow

pipe generator ($08) -> spawns child at $76 = $06 -> $07 (pop-out) -> $00 (walk)
bandit trap dispense -> $06 -> $07 (pop-out) -> $00 (walk)        ; shares the emerge states
```

The "$76 = $08 on init" / "CPY #$08 / BEQ" combo is subtle: the engine's
**EXRAM** state byte (the 9-state dispatch in `docs/spritestateengine.md`)
governs init/main/tongued/etc. lifecycle. The shy-guy's **$76** byte is a
parallel sub-state machine that progresses through walking/turning/etc.
Sub-state $08 is the **pipe-generator** entry: `init_shy_guy` seeds it only
when the sprite spawns on a pipe tile (§2.4), and the `CPY #$08 / BEQ`
pre-checks merely skip the per-slot physics/animation steps -- the table
dispatch itself still runs $08 every frame, so a pipe-mounted shy guy
continuously emits enemies. (Earlier notes claiming "$08 is never
dispatched" or that it is a bandit-grab cinematic were wrong: the
`$7E48 = $FFFF` grab-Yoshi write lives in the separate `ride_bandit_shyguy`
/ `CODE_04909B` routine, not in state $08.)

### 2.4 Pipe-generator mechanic (spawn-on-pipe)

`init_shy_guy` (`Bank04:1408`) chooses walker-vs-generator from the tile the
sprite spawns on. After the rider-flag short-circuit it calls the shared
pipe probe `CODE_0EB8AE` (`$0E:B8AE`), which runs a SuperFX BG-type check
(`FXCODE_0ACE2F`) at the sprite's position and reports "on a pipe" when the
tile is a hardcoded pipe-mouth tile (`$79F1`/`$79F2`) **or** its Map16 page
carries the DK collision tag (`$14` -> page `$7D`; see `docs/mchip.md`
§3.3.2). On a pipe it falls through to `$76 = $08` (generator); otherwise
`$76` stays `$00` (normal walker).

```
init_shy_guy:
  ... rider-flag path ...
  JSL CODE_0EB8AE      ; Z=1 if on a pipe tile ($79F1/$79F2 or DK page $7D)
  BNE walker_setup     ; off a pipe -> normal walker ($76 = $00)
  LDY #$08 : STY $76,x ; on a pipe  -> generator
```

The same probe is shared by three other sprites whose Inits also call
`CODE_0EB8AE`: Lantern Ghost (`$133`, shares `init_shy_guy`), Cactus Jack
(`$156`, `init_cactus_jack`) and Boo Guy (`$19A`, `init_boo_guy`) -- so all
four become pipe generators when a level places them on a pipe.

The DK tag is purely a *placement* signal: pipe objects stamp it on pipe
terrain (enterable and un-enterable pipes alike), so it is independent of
whether the player can enter the pipe -- player entry is the separate
entrance-sprite warp documented in `docs/family-pipes-signs.md`.

---

## 3. Variant-encoding mechanism (DP-mod tile grid)

The Shy Guy family uses a clever zero-RAM-cost trick to give level
designers four color variants per sprite ID without a dedicated palette
byte: the variant index is read out of the pixel-X / pixel-Y spawn
coordinates' bit 4. This is the two-axis form of an engine-wide idiom
(see `docs/spritestateengine.md` §10.2 Pattern A for the full catalog of
sprites that do this). The bit being read is **genuine position, not a
packed flag**: YI sprite records store whole-tile X/Y and spawn expands
them `tile * 16`, so pixel bit-4 is exactly the tile-coordinate LSB --
designers select the variant purely by which 16-px cell they drop the
sprite in.

### 3.1 The canonical recipe (CODE_048A18, Bank04:1446)

```
; Variant-bit assembly (canonical $01E):
LDA $701902,x          ; per-slot GenericTable701902 -- "palette already chosen"
BIT #$0001
BNE skip               ; already cached, fall through to use the stored value

LDA $70E2,x            ; pixel X (world space)
AND #$0010             ; bit 4 of pixel X (= row in 32-px grid)
LSR LSR LSR            ; bit 4 -> bit 1   (=> 0 or 2)
STA $00

LDA $7182,x            ; pixel Y
AND #$0010             ; bit 4 of pixel Y
LSR LSR                ; bit 4 -> bit 2   (=> 0 or 4)
ORA $00                ; combined: 0 / 2 / 4 / 6
TAY                    ; 4-way nibble index

LDA DATA_shy_guy_palette_indices,y   ; Bank04:1392 ; dw $0001,$0003,$0005,$0009
STA $701902,x          ; cache for subsequent frames
```

The four palette indices (`$0001/$0003/$0005/$0009`) map to Shy-Guy
palette rows in CGRAM via the OAM palette field. SMWC documents them as
Green / Red / Yellow / Pink respectively (this matches the in-game
colors).

The cache write to `$701902,x` (a generic per-slot byte) ensures the
expensive XY-bit shuffle runs only on the first frame; subsequent frames
short-circuit on the `BIT #$0001 / BNE skip` test.

After deriving the variant byte, the routine packs it into the OAM
attribute word:

```
AND #$00FE             ; clear bit 0 (preserve palette nibble)
ORA #$0020             ; set bit 5 (Shy-Guy fixed-palette-row flag)
STA $7042,x            ; OAM attribute word for this slot
```

So the level designer chooses Shy-Guy color purely by where they place
the sprite. If you want a red Shy Guy, drop it on a tile whose
(world X, world Y) bit-4 nibble is `(0, 1)` -> y-index $02 -> palette $0003.

### 3.2 Where else this pattern recurs

| Sprite | Bits used | Result space | What it varies |
|---|---|---|---|
| $01E shy-guy / $133 ghost | XY bit 4 each | 4-way (green/red/yellow/pink) | OAM palette nibble |
| $0F2 Stilt Guy | XY bit 4 each | 4-way | Tile / palette pair (`DATA_078538`) |
| $08D Flyguy | XY bit 4 each | 4-way (+1 -> 1..4) | Carried-item variant + tile pair (`DATA_03ECBB/03ECC3`) |
| $12B Fat Guy | X bit 4 only | 2-way | Small vs big (`DATA_fat_guy_init_variant_ptr`) |
| $192 Mufti / Petal Guy | (no DP-mod -- inherits $01E's pattern via shared CODE_048A18 call) | 4-way (after burst-replace) | Palette nibble of the post-burst $01E |

The Flyguy variant is the most game-impactful one: the four indices select
the color of the balloon AND the dropped item -- one variant drops the
1-up moon, another drops a coin, etc. This is encoded in `DATA_03ECBB`
(tile-data bank) and `DATA_03ECC3` (tile-data lo word) at Bank03:14214-14218.

### 3.3 Lantern Ghost ($133) deviation

The Lantern Ghost shares Init+Main+StompRt with $01E but the per-state
handlers branch on sprite ID to pick a different OAM tile / palette set:

```
LDA !EXRAM_YI_Level_NorSpr_SpriteID|!EXRAMBankMirror,x
CMP #!Define_YI_NorSpr01E_Shyguy
BEQ shyguy_path
CMP #!Define_YI_NorSpr133_LanternGhost
BEQ lantern_path
; ... etc.
```

There are at least 4 such `CMP #SpriteID` branches across the shared
Main + state handlers (Bank04:1439, 1760-1764, 1820-1824, 2277-2281).
This is the standard idiom for "same state machine, swap the visuals":
the variant identity is read out of the EXRAM sprite ID rather than
out of a per-slot byte.

### 3.4 Bandit Trap ($12A) deviation

`init_shy_guy_bandit_trap` (Bank04:1382) is just:

```
LDY #$05
STY $76,x              ; pre-seed sub-state $05 (the trap-trigger stub)
RTL
```

So the trap "is a $01E that starts its life sitting at the $05 stub
waiting to be poked". When the player touches it (via the on-collide
ride-yoshi path), `CODE_048D13` (Bank04:1855) fires:

```
JSL CODE_06BEBA                 ; spawn the ambient star-burst
LDA #$0020
JSL CODE_spawn_sprite_active    ; spawn a new sprite ($0020 = Mario in his bubble?)
... (copy our coords into the new slot) ...
LDA #$000A
STA !EXRAM_YI_Level_NorSpr_CurrentStatus,x   ; enter ride-yoshi state ($0A)
TXA
STA $7E48                       ; signal level-exit
LDA #$8000
STA $0390
LDA #$FFFF
STA $0CD0                       ; force level-exit cinematic
LDA #$0020
STA $0CC8
```

I.e. the bandit picks up Yoshi (via the engine ride-yoshi state $0A) and
forces an immediate level-exit. The level-loader sees `$7E48 != $FFFF`
and triggers the bandit-bonus minigame transition.

---

## 4. Per-sprite breakdown

### 4.1 $01E Shyguy (canonical walker)

The base case. Init/Main/StompRt as documented in section 2.
Identical visual+behaviour to the "Shy Guy" of every YI level except for
its DP-mod palette color. Stomped via `stomp_shy_guy` (Bank04:2299)
which arms 1-frame despawn and jumps to engine `CODE_head_bop_common`.

### 4.2 $124 Stretch

Bank04:2371 (Init), Bank04:2424 (Main), Bank04:2407 (state ptrs).
Stretch is the "elongating Shy Guy" from World 5 cave levels: walks on
ground until Yoshi comes near, then extends a neck arm forward; if Yoshi
gets close enough during the extension, pulls Yoshi back into its body
(forced bonus-game entry).

**7-state machine** (`DATA_stretch_state_ptr`, Bank04:2407):

| $76,x | Handler | Behaviour |
|---|---|---|
| $00 | `CODE_shy_guy_state_00_walk` | (Shared with $01E.) |
| $01 | `CODE_shy_guy_state_01_turn` | (Shared with $01E.) |
| $02 | `CODE_stretch_state_02_swing_toward_yoshi` | Arm extends; may spit projectile via `CODE_spawn_sprite_active(#$0107)`. |
| $03 | `CODE_stretch_state_03_pull_yoshi` | Tug Yoshi back into body (the "lock-in" hook). |
| $04 | `CODE_stretch_state_04_retract` | Shorten arm back to body; reset gfx. |
| $05 | `CODE_stretch_state_05_fly_out_defeated` | Death-pop: star explosion + impulse out. |
| $06 | `CODE_stretch_state_06_despawn` | Cleanup / despawn. |

Init also allocates a SuperFX dynamic-tile slot via `CODE_03AD74` for the
bend animation, and seeds sub-state $06 (extending) at $76. Note the
state-index reuse: states $00 / $01 are the same `CODE_shy_guy_state_*`
entries as the canonical $01E walker -- so Stretch literally borrows the
shy-guy walk+turn behaviour for sub-states $00/$01 and only overrides
$02-$06 for its unique extending/retracting logic.

### 4.3 $12A Shy Guy Bandit Trap

See section 3.4. Cosmetic identical to $01E, behavioural override is
"on Yoshi-touch, force level exit". Spawn slot enters sub-state $05 (the
trap-trigger stub) directly; doesn't run a walk cycle.

### 4.4 $133 Lantern Ghost

See section 3.3. Shared Init/Main/StompRt with $01E; differs only in OAM
tile/palette via `CMP #SpriteID` branches inside the shared state
handlers.

### 4.5 $192 Petal Guy / Mufti Guy

Bank04:2841 (Init), Bank04:2863 (Main), Bank04:2852 (state ptrs).

A flower in disguise; on attack ($CurrentStatus = $08, i.e. tongued or
egg-hit) bursts into 4 ambient $210 petal sprites and replaces itself
with a $01E Shy Guy via `CODE_03A366 spawn_sprite_active_with_Y` while
preserving the OAM attribute word (palette/priority bits) and the
sprite-bonded $74A0 word. The replacement Shy Guy inherits its
predecessor's pixel position and the post-burst velocity.

**2-state machine** (`DATA_mufti_guy_state_ptr`, Bank04:2852):

| $76,x | Handler | Behaviour |
|---|---|---|
| $00 | `CODE_mufti_guy_state_00_hide_as_flower` | Watch for petal-poke; transition to $01 on threshold. |
| $01 | `CODE_mufti_guy_state_01_reveal_animate` | Animation of the revealed Shy Guy emerging from the petals. |

The burst itself happens in `CODE_mufti_guy_burst_petals` (Bank04:3124):
spawns 4 ambient $210 petal-puff sprites with offsets $0/$1/$2/$3 around
the disguise centre, then `CODE_spawn_ambient_sprite`-installs them.

### 4.6 $09B Mace Guy

Bank04:10355 (Init), Bank04:10392 (Main).

Mace Guy is a walking enemy that, at spawn, immediately spawns a child
mace sprite $09C via `CODE_spawn_sprite_init` and stores the child's slot
in its own $18,x. The child orbits the parent via SuperFX `FXCODE_0B86B6`
angle math (radius set via $7A36); on parent's death the child detaches
with -$FFC0 upward velocity (`$7A36 = $0100` becomes the "alive" guard).

When the Mace Guy gets stunned (CurrentStatus = $08), `CODE_04D27E`
(Bank04:10449) replaces it with a $01E Shy Guy via `CODE_spawn_sprite`,
preserving the OAM attribute word, X-speed, and current $7D96 hit-state
flag.

### 4.7 $0EC / $0ED Flamer Guys

Bank05:8540 (shared Init), Bank05:8582 (shared Main), Bank05:8572 (state
ptrs).

7-state shared machine (`DATA_flamer_guy_state_ptr`):

| $76,x | Behaviour |
|---|---|
| $00 | Idle / walk |
| $01 | Ignite charge (build-up animation) |
| $02 | Flame-on (running flame trail or jumping) |
| $03 | Airborne (jump variant only) |
| $04 | Lands, brief cooldown |
| $05 | Flame-out / recover |
| $06 | Revert-to-Shyguy (spawns a $01E, restores walking, deletes self) |

The two variants differ only in their initial velocity: Jumping
($0EC) gets an initial -Y velocity of $FC00 and shorter ground time;
Running ($0ED) stays grounded and gets a fire trail emitted along its
path. Both reach state $06 after a flame-out timer expires, at which
point `CODE_spawn_sprite` is called with `#!Define_YI_NorSpr01E_Shyguy`
and the slot's $7042 and $701902 are reset to the standard Shy Guy
values. After that, the original sprite is despawned via `CODE_03B273`.

### 4.8 $0F2 Shyguy On Stilts

Bank07:727 (Init), Bank07:774 (Main), Bank07:830 (state ptrs).

Init runs the DP-mod 4-way variant probe (XY bit-4 nibble) to pick a
tile-set + palette pair from `DATA_078538`. Main is a **2-state**
dispatch (`DATA_stilt_guy_state_ptr`):

| $76,x via $16,x | Handler | Behaviour |
|---|---|---|
| $00 | `CODE_078644` | Standing-walk (with stilt). Walk anim cycles every 3 frames, with sub-pattern frames from `DATA_078614`. |
| $01 | `CODE_0786C6` | Squashed-runaway (post-stomp). Falls + runs without the stilts. |

The `StompRt` (`head_bop_stilt_guy` at Bank07:1090) is the key transition:
it spawns the falling-stilt ambient sprite `$1F7` to render the discarded
stilts, then re-enters the walker state $01. After re-entry, the
$701902 cached variant byte selects a SHORTER tile-set for the
no-stilt body.

### 4.9 $0F5 Slugger

Bank07:1147 (Init), Bank07:1177 (Main), Bank07:1219 (state ptrs).

5-state egg-deflection machine (`DATA_slugger_state_ptr`):

| $76,x via $16,x | Behaviour |
|---|---|
| $00 | Walk -- patrol cycle |
| $01 | Pick up bat (detected incoming egg) |
| $02 | Wind-up animation |
| $03 | Swing -- on connect, the egg slot's X-speed is mirrored (so the egg returns toward Yoshi as a damaging projectile) |
| $04 | Cooldown -- can't swing again for a beat |

The animation timeline is in `DATA_078895` (18-frame swing-cycle table).
Egg detection: walks along checking for any sprite slot with
`SpriteID == #$0020` (an egg) crossing his "bat zone" defined by his
$74A0 state byte; on connect, swings via `CODE_03B53D` (a generic
projectile-deflect helper) and re-spawns the egg at the bat-tip with
inverted X-speed.

### 4.10 $0FB / $0FC Long / Short Spear Guy

Bank07:2072 (Long Init), Bank07:2084 (Short Init), Bank07:2143 (shared
Main), Bank07:2219 (state ptrs).

3-state shared machine (`DATA_spear_guy_state_ptr`):

| $76,x via $16,x | Behaviour |
|---|---|
| $00 | Walk |
| $01 | Throw -- stab forward; spear length comes from per-variant pattern table |
| $02 | Recover -- retract spear |

Long ($0FB) uses `DATA_079261` length pattern; Short ($0FC) uses
`DATA_07926D` (lower amplitude). Only the Init differs -- it stores the
pattern-table pointer in $18,x (`STA.b $18,x`), and the shared Main
reads through it to drive the stab cycle. Both share `DATA_079078` (hitbox
width) and `DATA_07907E` (hitbox depth) tables indexed by current stab
frame.

### 4.11 $0FD / $0FE Zeus Guy + Zeus Guy Blast

Bank07:9853 (Zeus Init), Bank07:9875 (Zeus Main), Bank07:9986 (state
ptrs), Bank07:11096 (Blast Init), Bank07:11115 (Blast Main).

**Zeus Guy itself ($0FD)** has TWO parallel state tables:

- `DATA_zeus_guy_main_state_ptr` (7 entries) -- the gameplay state
  machine: walk / wind-up / fire / recover + 3 hit-variants.
- `DATA_zeus_guy_anim_state_ptr` (7 entries) -- the parallel animation
  state machine. Each gameplay state has its own animation handler.

Plus a separate `DATA_zeus_guy_hit_state_ptr` (4 entries) for the
"just-took-a-hit" sub-states (taken-hit phase variants).

So Zeus Guy's Main dispatches:
- If on the ground (bit 0 of $7860): pick from `hit_state_ptr` based on
  $16,x (hit phase index).
- Otherwise: pick from `main_state_ptr` (the normal state).
- Always animate via `anim_state_ptr` (running in parallel with the gameplay
  state).

The fire-blast state spawns the **Zeus Guy Blast ($0FE)** projectile via
`JSL.l YI_NorSpr0FE_ZeusGuyBlast_Init`. The blast is a linear-travelling
sprite with a looping 22-frame animation cycle; damages Yoshi on contact,
spawns ambient explosion $20A on hit, then despawns.

The Stomp handler `head_bop_zeus_guy` (Bank07:11036) re-runs
`CODE_init_zeus_guy` to reset the Zeus Guy to its initial state -- so
stomping a Zeus Guy doesn't kill it, it just resets it (and presumably
the player gets the head-bop visual feedback). Egg hit kills it normally.

### 4.12 $113 / $114 Snifit + Snifit Bullet

Bank07:2554 (Snifit Init), Bank07:2572 (Snifit Main), Bank07:2582
(state ptrs), Bank07:2653 (shoot-anim ptrs), Bank07:2764 (Bullet Init),
Bank07:2779 (Bullet Main).

2-state Snifit machine:

| $76,x via $16,x | Behaviour |
|---|---|
| $00 | Roaming -- walk patrol with frame-cycle anim |
| $01 | Shooting -- enter at fixed interval, run 7-frame shoot animation, spawn $114 Snifit Bullet on the firing frame |

The shoot anim is itself dispatched (`DATA_snifit_shoot_anim_ptr`,
7 entries -- most idle, two emit projectile). Each frame's per-frame
behaviour comes from this nested table.

### 4.13 $11A Green Glove

Bank07:4038 (Init), Bank07:4054 (Main), Bank07:4170 (state ptrs).

5-state catcher (`DATA_green_glove_state_ptr`):

| $76,x | Behaviour |
|---|---|
| $00 | Walk -- patrol cycle |
| $01 | Catch -- detected incoming egg, glove-grab anim |
| $02 | Hold -- hold the egg, wind up |
| $03 | Throw -- mirror egg X-speed, fire projectile |
| $04 | Look-up -- post-throw recovery |

Conceptually identical to the Slugger ($0F5) but uses a "glove catch +
throw" cycle instead of "bat swing". The egg-deflect math is shared via
`CODE_03B53D`.

### 4.14 $12B Fat Guy

Bank07:5728 (Init), Bank07:5802 (Main), Bank07:5810 (state ptrs).

Two-variant DP-mod (small/big from X bit 4): Init picks
`DATA_fat_guy_init_variant_ptr` entry 0 (small) or 1 (big), each setting
a different per-state-walk speed (`$60` vs `$100`) and per-state recovery
time.

4-state machine (`DATA_fat_guy_state_ptr`):

| $76,x via $16,x | Behaviour |
|---|---|
| $00 | Walk -- 12-frame walk cycle (`DATA_07AE7A`) |
| $01 | Turn -- 2-frame turn cycle (`DATA_07AEAD`) |
| $02 | Fall -- 4-frame land animation (`DATA_07AED0` + `DATA_07AED4`) |
| $03 | Squashed -- 8-frame squash recovery (`DATA_07AEFA` + `DATA_07AF02`) |

Egg-hit kicks back via the "growth-sound" path (the small-fat-guy variant
hops backward; the big variant tumbles). Fat Guys bounce off each other:
on side collision, both swap X-velocity sign (bilateral X-swap).

### 4.15 $159 / $15A Walking + Running Grunt

Bank07:8833 (Walking Init), Bank07:8855 (Running Init), Bank07:8874
(Walking Main), Bank07:8890 (Running Main).

Both have separate 5-state dispatch tables that share most handlers:

| $76,x via $16,x | Walking ($159) | Running ($15A) |
|---|---|---|
| $00 | walk (`CODE_07C719`) | run (`CODE_07C741`, different anim table) |
| $01 | turn (`CODE_07C79D`) | turn (same) |
| $02 | jump-prep (`CODE_07C7EB`) | jump-prep (same) |
| $03 | jump (`CODE_07C76A`) | jump (same) |
| $04 | land (`CODE_07C83A`) | land (same) |

The variants only differ in their initial X-speed (`DATA_07C6A2`
$FFA0/$0060 for walking vs `DATA_07C6C7` $FF00/$0100 for running) and
the anim-table they cycle through (`DATA_07C714` for walking is a 5-frame
walk; `DATA_07C73F` for running is a 2-frame run). Both have spike-hats
that prevent simple stomp -- they jump backward on egg-hit (state $02 ->
$03 with `Y-speed = -$FE00`).

### 4.16 $15B Dancing Spear Guy

Bank07:9200 (Init), Bank07:9251 (Main), Bank07:9277 (dance state ptrs),
Bank07:9289 (solo state ptrs).

Dual-mode enemy with **two parallel 9-state dispatch tables**:

- `DATA_spear_guy_dancing_dance_state_ptr` -- choreographed dance/throw
  pattern synchronised with the level conductor sprite via $0C50.
- `DATA_spear_guy_dancing_solo_state_ptr` -- independent solo state
  machine when no conductor is present.

The Init picks which by checking `$0C50` (level controller). The Main
also re-checks via `$0CD8` (a per-frame conductor-beat flag) so dancers
can SYNC to the beat that frame even if they spawned in solo mode (and
vice versa). Both 9-state tables have the same general shape (walk /
turn / dance-step variants / throw / cooldown).

### 4.17 $0F3 Woozy Guy

Bank0C:15533 (Init), Bank0C:15616 (Main).

Walks dizzy on the YI wavy-floor effect. 6-state walk cycle (4 walk
phases / dizzy / fall) + on-hit branches into a 2-state knockback
(knockback / land) via $701901. Init has 2 sub-variants: regular vs
ceiling-walker, picked by `FXCODE_0ACE2F` probe (which queries the SuperFX
to determine if there's a ceiling overhead). The ceiling variant
re-anchors gravity sign so the Shy Guy walks upside-down on the ceiling.

### 4.18 $19A Boo Guy

Bank0C:1539 (Init), Bank0C:1581 (Main), Bank0C:1622 (state ptrs).

The "Shy Guy with a sheet" ghost variant. 6-state machine
(`DATA_boo_guy_state_ptr`):

| $76,x via $16,x | Behaviour |
|---|---|
| $00 | Idle (hidden) |
| $01 | Walk (random meander) |
| $02 | Surprise (Yoshi has turned to face me; reveal!) |
| $03 | Chase (Yoshi nearby; fast pursuit) |
| $04 | Fade (slow ghost-fade, lower alpha via $74A2) |
| $05 | Vanish (despawn animation) |

The trigger is the **face-direction match**: Boo Guy hides while Yoshi
faces toward him (state $00/$01), reveals + chases when Yoshi faces away
($02/$03). The decision uses `$60C4` (Yoshi facing) compared against the
Boo Guy's X position relative to Yoshi. Defeated by egg-hit (stomp-immune
like all Boos): splits into a 2-state burst (`DATA_boo_guy_burst_state_ptr`).

### 4.19 $105 / $106 Boo Guys Carrying Bomb

Bank0D:485 (Left Init), Bank0D:495 (Right Init), Bank0D:674 (shared Main),
Bank0D:666 (state ptr `DATA_0D84A5`).

Pair-cooperative carriers. Init stores direction in $7400 (0 for $105,
2 for $106), claims a slot in the `$0EEF` pair-table, allocates chain-rope
data at `$0EF7+`, runs `FXCODE_0ACE2F` to probe rope length to ceiling.
The two Boo Guys carry an explosive ball ($060 Bomb) along a swinging rope
path; they drop it when timer $61C6 fires.

3-state shared Main (`main_boo_guys_carrying_bombs`, `DATA_0D84A5`):

| state | Behaviour |
|---|---|
| $00 | Carry along (synchronous left/right swing) |
| $01 | About to drop -- pre-drop frame |
| $02 | Bomb released -- carriers fly apart and despawn |

### 4.20 $047 Shy Guy Pushing Roger

Bank0C:12958 (Init), Bank0C:13013 (Main).

Two Shy Guys cooperatively pushing a "Roger the Potted Ghost" sprite
($034). Init spawns a paired partner (also $047) at +$40 X, linking via
$701978/$701900 so the two pushers know about each other. 2-state main
(push-active / paused); shoves the pot anchor at $7A36 per direction.
If the pot is destroyed (Roger emerges), both pushers panic-walk away
(via fall-back to the $01E walker behaviour). The pushers themselves
are ordinary $01E shy-guys for visual purposes, just with a different
state machine that synchronises with the partner.

### 4.21 $072 Train Bandit

Bank0C:14363 (Init), Bank0C:14386 (Main).

Chalk-board Shy Guy enemy active only when Yoshi is in Form $08 Train
(the railroad mini-form). Init seeds the chalk-line animation; Main is
gated on `Form $08 + flag $6180` (the train-active flag) and uses
SuperFX `FXCODE_0AE9AE` to do per-pixel collision against the chalk-stamp
table at `$0CF19C`. Each intersection deflects the train's velocity per
the chalk-pattern map; this is the "Shy Guy draws chalk lines that
redirect the train" mechanic.

### 4.22 $153 Goonie with Shy Guy

Bank0E:2631 (Init), Bank0E:2751 (Main).

Not a Shy Guy itself but a Goonie carrier. Init alias `init_goonie_with_shyguy`
is shared with $0E8/$0E9 (regular Goonie variants); on launch, the
Goonie spawns a $01E Shy Guy passenger via `CODE_03A366` and stores the
passenger slot in $78,x. The Goonie then re-tags itself as a $0E8 (plain
Goonie) so its remaining lifecycle is "regular Goonie carrying a child".
The Shy Guy passenger drops off when the Goonie is stomped (its X-speed
becomes the Shy Guy's, ditto Y-speed).

### 4.23 $173 / $176 Baron Von Zeppelin Carrying Shy Guy / Bandit

Bank07:14035 ($173 Init), Bank07:14023 ($176 Init), Bank07:14174 ($173
Main), Bank07:14177 ($176 Main).

BVZ balloon variants that drop a Shy Guy ($173) or a Bandit Shy Guy
($176) when stomped/popped. Both share the simple-payload Main
(`main_bvz_simple`); only Init differs by setting the payload-type byte
(`$00` for Shy Guy, `$06` for Bandit). On pop, `CODE_03A366` spawns the
payload at the carrier's pixel position with default Init.

### 4.24 $08D Flyguy

Bank03:14226 (Init), Bank03:14272 (Main), Bank03:14279 (state ptrs).

The classic balloon-carrying Shy Guy that drops items. Init uses
DP-mod 4-way variant probe via XY bit 4 to derive `$701901,x` index
$01..$04; this selects:

- Tile data: `DATA_03ECC3,y` (low word) + `DATA_03ECBB,y` (high byte) ->
  one of 4 OAM tile patterns.
- "Carried item" target: payload sprite ID for the drop.
- Animation timing: spawn-rest cycle.

Main dispatches via 2-entry top-level table (`DATA_flyguy_top_state_ptr`)
into either "alive" or "swallowed" branch. The alive branch then
dispatches via 5-entry `DATA_flyguy_alive_state_ptr`:

| $18,x | Behaviour |
|---|---|
| sub 0 | Enter (spawn at screen edge, set drift speed) |
| sub 2 | Drift (lateral flight) |
| sub 4 | Detect player below |
| sub 6 | Drop bomb / item |
| sub 8 | Turn around / leave |

The drop spawns a payload sprite (one of: red coin, 1-up moon, plus
ammo, smiley flowers) on detection of Yoshi below. The "swallowed"
branch handles the in-mouth path when Yoshi tongues the Flyguy itself.

### 4.25 $103 Boo Guys' Moving Mace

Bank04:11394 (Init), Bank04:11406 (Main).

Mace tossed between two Boo Guys. Pixel-X bit 4 picks initial owner;
$7402 cycles 0..4 every 8 frames to animate the swing. Visually, two
Boo Guys catch and re-throw the mace back and forth across a path; the
mace itself is the sprite. Damage to Yoshi on hitbox-overlap during swing.

---

## 5. Background Shy Guy ($0AA) special case

The Background Shy Guy lives in its own ROUTINE file
(`yi/Routines/ROUTINE_YI_NorSpr0AA_BackgroundShyguy.asm`) rather than
in a Bank file, because it's emitted at two different SNES addresses
depending on ROM version (V1.0 in Bank00 at $00:86E9 / V1.1 in Bank0F
at $0F:9435) via per-version `%ROUTINE_YI_NorSpr0AA_BackgroundShyguy`
macro instantiation.

### 5.1 BG2 anchoring

Init re-projects spawn coordinates from BG1-space into BG2-space:

```
new_X = spawn_X - !RAM_YI_Global_Layer1XPosLo + !RAM_YI_Global_Layer2XPosLo
new_Y = spawn_Y - !RAM_YI_Global_Layer1YPosLo + !RAM_YI_Global_Layer2YPosLo
```

Plus a +8/AND-$FFF8/+10 nudge on Y to snap to a row boundary on BG2.
The result is stored back into $70E2 + the per-slot "anchor" wildcard
$701900 (so the turn-around timer knows the anchor).

The BG layer field $74A1,x is bumped from 0 (BG1) to 2 (BG2):

```
INC.w $74A1,x
INC.w $74A1,x
```

This is two `INC`s, not a `LDA #2 STA`, because the field is a layer-stride
count (each `INC` moves to the next BG plane) rather than a bitfield.

### 5.2 Parallax + camera-aware despawn

Each frame, Main first calls:

- `CODE_03AF23` -- standard BG-anchored sprite-frame advance (the BG2
  variant of the per-frame body update).
- `CODE_03A2C7` -- cull check: returns carry-clear if on-screen.

Off-screen: `JML CODE_despawn_sprite_free_slot` (engine despawn helper at
Bank03:$03:A32E, frees the slot completely).

On-screen: walk +/-32 pixels from the anchor (clamped via signed-dx
test), reverse direction on edge-touch OR random timer expiry
($7AF6,x = $30..$4F frames). Frame anim alternates every 8 frames between
2 walk frames.

The unusual feature: at spawn, if the camera is mid-scroll
(`$0073 = r_cam_moving_dir_x != 0`), the sprite **immediately** despawns
(`JML CODE_03A31E`) to avoid a pop-in glitch. Background sprites only
spawn when the camera is parked.

### 5.3 Why no stomp / no tongue path

The Background Shyguy's `_StompRt` and `_RideYoshiRt` both point to the
shared `init_unused_rtl_stub` ($03:9A6B). It's intentional: the
background plane is non-interactive. Yoshi can't reach it (BG2 isn't a
collision layer), so the engine's tongue-eat and head-bop paths never
fire on it.

---

## 6. Giant Shy Guy ($043 / $044)

Bank02:8754-8755 (shared Init label aliases), Bank02:8782-8783 (Main
label aliases), Bank02:8779 (anim frame table `DATA_02CF9F`).

### 6.1 Why the shared init label looks wrong

The Init labels at Bank02:8754-8755 are:

```
YI_NorSpr042_RedGiantShyguy_Init:
YI_NorSpr043_GreenGiantShyguy_Init:
CODE_init_giant_shyguy:
```

Note the `$042` in the first label is a documentation-tooling artifact
from the name "Red Giant Shy Guy" being historically at sprite ID
$042. **The real sprite ID $042 is Vertical Pipe Entrance** (see
`yi/Constants/NormalSpriteIDs.asm:86`). The actual Red Giant Shy Guy is
sprite ID $043, and the Green is $044. The asar label alias at line 8754
is benign (asar accepts duplicate labels at the same address) and
preserved for historical / cross-reference reasons; the sprite-pointer
tables in Bank03 dispatch on the real IDs $043/$044, not $042.

### 6.2 Init body

Init clears OAM priority bits, sets render-scale `$75E2 = $0100`
(unit scale), and seeds the X-speed via `DATA_02CF6E` ($FFA0/$0060)
keyed by $10 bit-1 -- a 1-bit random direction picker. The walk-anim
$7400,x is set to 0 or 2 based on `$10 AND #$0002`.

### 6.3 Main body

`main_giant_shyguy` (Bank02:8782) is unique in the family: it doesn't
use a dispatch table. Instead it's a procedural per-frame body that
branches on engine state:

```
LDA NorSpr_CurrentStatus,x
CMP #$0008                  ; tongued? (= stomped from above in mini-boss sense)
BNE not_swallow

; SWALLOW PATH:
STA $701902,x               ; mark phase-byte as "in swallow"
LDA #$0400
STA $75E2,x                 ; scale up to 4x (giant)
LDA $6FA0,x
ORA #$0600                  ; set priority bits
STA $6FA0,x
LDA $6FA2,x
ORA #$0017                  ; set palette + priority
STA $6FA2,x
(no return -- continues into swallow animation timer)
```

The mini-boss swallow path: when Yoshi stomps a Giant Shy Guy, the
Giant Shy Guy doesn't die -- instead it enters a "swallow Yoshi"
cinematic (the player gets eaten into a bonus-game transition?).

The non-swallow path runs `CODE_03AF23` (frame advance), then advances a
phase byte at $76,x, then walks via `DATA_02CF9F` (the 7-step walk anim
table). When the giant lands on solid ground (bit 0 of $7860 set), it
walks horizontally and animates through `DATA_02CF9F` (`db
$00,$01,$02,$03,$04,$03,$02` -- a 7-frame walk cycle that ping-pongs
through 5 frames).

### 6.4 No DP-mod variants

Unlike the regular Shy Guy family, the Giant variants have HARDCODED
palettes (Red vs Green); no DP-mod variant selection. The `DATA_02CF6E`
table is 2-entry (X-speed only) not 4-entry.

---

## 7. Cross-references

### 7.1 Constants entries

All in `yi/Constants/NormalSpriteIDs.asm`:

- `!Define_YI_NorSpr01E_Shyguy = $001E` (line 50)
- `!Define_YI_NorSpr042_VerticalPipeEntrance = $0042` (line 86)
- `!Define_YI_NorSpr043_RedGiantShyguy = $0043` (line 87)
- `!Define_YI_NorSpr044_GreenGiantShyguy = $0044` (line 88)
- `!Define_YI_NorSpr047_ShyguyPushingRoger = $0047` (line 91)
- `!Define_YI_NorSpr072_TrainBandit = $0072` (line 140)
- `!Define_YI_NorSpr08D_Flyguy = $008D` (line 167)
- `!Define_YI_NorSpr09B_MaceGuy = $009B` (line 181)
- `!Define_YI_NorSpr0AA_BackgroundShyguy = $00AA` (line 196)
- `!Define_YI_NorSpr0EC_JumpingFlamerGuy = $00EC` (line 266)
- `!Define_YI_NorSpr0ED_RunningFlamerGuy = $00ED` (line 267)
- `!Define_YI_NorSpr0F2_ShyguyOnStilts = $00F2` (line 272)
- `!Define_YI_NorSpr0F3_WoozyGuy = $00F3` (line 273)
- `!Define_YI_NorSpr0F5_Slugger = $00F5` (line 275)
- `!Define_YI_NorSpr0FB_LongSpearGuy = $00FB` (line 281)
- `!Define_YI_NorSpr0FC_ShortSpearGuy = $00FC` (line 282)
- `!Define_YI_NorSpr0FD_ZeusGuy = $00FD` (line 283)
- `!Define_YI_NorSpr0FE_ZeusGuyBlast = $00FE` (line 284)
- `!Define_YI_NorSpr103_BooGuysMovingMace = $0103` (line 289)
- `!Define_YI_NorSpr105_BooGuysCarryingBombToLeft = $0105` (line 291)
- `!Define_YI_NorSpr106_BooGuysCarryingBombToRight = $0106` (line 292)
- `!Define_YI_NorSpr113_Snifit = $0113` (line 305)
- `!Define_YI_NorSpr114_SnifitBullet = $0114` (line 306)
- `!Define_YI_NorSpr11A_GreenGlove = $011A` (line 312)
- `!Define_YI_NorSpr124_Stretch = $0124` (line 322)
- `!Define_YI_NorSpr12A_ShyGuyBanditTrap = $012A` (line 328)
- `!Define_YI_NorSpr12B_FatGuy = $012B` (line 329)
- `!Define_YI_NorSpr133_LanternGhost = $0133` (line 337)
- `!Define_YI_NorSpr153_GoonieWithShyGuy = $0153` (line 369)
- `!Define_YI_NorSpr159_WalkingGrunt = $0159` (line 375)
- `!Define_YI_NorSpr15A_RunningGrunt = $015A` (line 376)
- `!Define_YI_NorSpr15B_DancingSpearGuy = $015B` (line 377)
- `!Define_YI_NorSpr173_BaronVonZeppelinCarryingShyGuy = $0173` (line 401)
- `!Define_YI_NorSpr176_BaronVonZeppelinCarryingBandit = $0176` (line 404)
- `!Define_YI_NorSpr192_PetalGuy = $0192` (line 432)
- `!Define_YI_NorSpr19A_BooGuy = $019A` (line 440)

### 7.2 Engine architecture

- `docs/spritestateengine.md` -- the 9-state engine that every family
  member dispatches through. Especially relevant: section 5.3 (`spr_state_tongued`,
  the tongue-eat path that swallows the Shy Guy into Yoshi's mouth) and
  section 4 (the four per-sprite pointer tables that resolve each sprite
  ID's Init/Main/HeadBopped/RideYoshi handler).
- `docs/leveldataengine.md` -- how the level's sprite-spawn list
  allocates slots and seeds the per-slot bytes (including the pixel-X /
  pixel-Y values the DP-mod variant probe reads).
- `docs/bossengine.md` -- general boss machinery (Hookbill); some of the
  Boo-Guy-bomb cooperative-pair logic uses similar slot-linking patterns.

### 7.3 Parallel reference sources

- `ys_enmy.asm` / `ys_enmy0.asm` -- parallel main 65816 source of the
  sprite engine and the simpler walkers.
- `ys_enmy2.asm` -- parallel source for many Bank04 walker handlers.
- `ys_enmy3.asm` -- parallel source for Flyguy and aerial enemies.
- `yoshisisland-disassembly/disassembly/bank04.asm` -- Raidenthequick's
  descriptive labels for the Shy Guy family (init_shy_guy, main_shy_guy,
  init_stretch, etc.); used as a Rosetta stone for the inline label
  aliases throughout this doc.
- `yoshisisland-disassembly/disassembly/bank07.asm` -- ditto for the
  Bank07-resident specialty variants.

---

## 8. Open questions

1. **State byte $76 = $08 on init -- RESOLVED.** `init_shy_guy`
   (Bank04:1426) ends the on-pipe path with `LDY #$08 / STY $76,x / RTL`.
   The earlier worry ("how does the slot leave $08, and is it ever
   dispatched?") was based on a misread of the dispatcher: the `CPY #$08 /
   BEQ` target is `CODE_048A8A`, which *falls into* the table dispatch -- it
   only skips the per-slot pre-dispatch physics/animation, not the dispatch
   itself. So $08 **is** run every frame. $08 is the **pipe-generator**
   state: `init_shy_guy` seeds it only when the sprite spawns on a pipe tile
   (`CODE_0EB8AE`; §2.4), and the slot stays at $08 for its lifetime,
   continuously emitting children while Yoshi is near. Off-pipe shy guys
   spawn at $76 = $00 and never enter $08. The handler (now
   `CODE_shy_guy_state_08_pipe_generator`, formerly mislabeled
   `..._collide_player`) is reached only via the dispatch table; the
   `$7E48` grab-Yoshi cinematic is a separate routine (`ride_bandit_shyguy`
   / `CODE_04909B`), unrelated to $08.

2. **Bandit Trap forced-exit cinematic** ($12A, `CODE_048D13`): writes
   `$7E48 = $FFFF` and bumps `$0CC8 = $0020` along with `$0CD0 = $FFFF`.
   Where are these consumed? Likely the level-loader (`docs/levelloader.md`)
   checks $7E48 on the next game-mode tick. Worth confirming the exact
   transition: does it always send to the bandit-bonus minigame, or can
   it route to a different scene based on $0CC8?

3. **DP-mod variant index** has 4 entries (`DATA_shy_guy_palette_indices`)
   but the BIT-shuffle logic produces a 4-bit nibble (0/2/4/6) that
   indexes into a word-table. SMWC documents the 4 colors as Green / Red
   / Yellow / Pink; this matches the gameplay observation. But: are there
   additional unused palette slots beyond these 4 that level designers
   could theoretically reach by manipulating the seed bits? Unclear --
   the index field is `AND #$0006` so it's hard-capped at 4 entries.

4. **Stretch's state $06** is labelled "despawn / cleanup" but the asm
   body `CODE_stretch_state_06_despawn` (Bank04:2541) appears to route
   to retract logic (state $04). It might be the entry-default sub-state
   that immediately moves to retract; the "despawn" labeling may be
   misleading. The Init sets $76 = $06, so the first state run is $06,
   not the "expected" $00 walk.

5. **Mufti Guy's burst-and-replace pattern**: when a Petal Guy is
   attacked, the entire $192 slot is destroyed and a new $01E slot is
   spawned at the same pixel coordinates. Two ambient sprites coexist
   briefly: the dying $192 and the spawning $01E. Are there any frames
   where both render simultaneously, or does the slot-swap happen
   atomically within `CODE_03A366`? Worth tracing.

6. **Variant index in OAM**: the `STA $7042,x` writes the assembled
   variant byte plus other bits, but the OAM-render path further down
   the per-frame chain may apply additional palette bits on top. Need to
   trace the exact CGRAM palette-row each color (Green/Red/Yellow/Pink)
   ends up in to fully verify the DP-mod -> on-screen-color mapping.
