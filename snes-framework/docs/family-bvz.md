# YI Baron Von Zeppelin (BVZ) carrier-balloon family reference

Standalone reference for the Yoshi's Island "balloon-with-a-monocle"
sprite family -- the propeller-helmeted enemies that drift in from
screen edge, hover above Yoshi, and drop a payload (enemy or item)
straight onto his head. The base balloon is `$17F`; the family fans
out to 12 payload-typed variants ($173-$17E) plus the closely-related
$0CD GiantEgg carrier covered in `docs/family-eggs.md` §5.3.

Every payload variant shares the same balloon visual + drift physics;
the divergence is which sprite gets handed off when the balloon's
"drop the payload" trigger fires. The trigger fires three ways:

1. **Egg hit** -- the player puts an egg through the balloon. The
   balloon pops on the same frame and the payload is dispensed in
   mid-air to give Yoshi a chance to catch it.
2. **Aerial collision with Yoshi** (`$6FA0,x & $0400`) -- Yoshi
   collides with the balloon (head-bonk, riding-up a Spring Ball,
   etc.). Same release path.
3. **Aim-aligned with Yoshi** (carrier-screen-Y near top, Yoshi-X
   within 8 px) -- the natural "drop on you" trigger. The carrier
   despawns and the bare `$17F` Baron is spawned in a fresh slot to
   continue the drift-away arc post-drop.

`$17F` itself (the no-payload Baron) is the despawn artifact + a
standalone level-data sprite when the level designer wants a "decoy"
balloon. Its own 2-state Main is straight drift + the player-aim drop
trigger that overrides Yoshi-Y to simulate the parachute-grab.

Source of truth: framework asm at `yi/Banks/Bank07.asm` lines
14107-15640 (all 13 BVZ sprites live in one contiguous block);
SuperFX visuals routed through `FXCODE_0895B9` / `FXCODE_0895F4`
(balloon renderers), `FXCODE_088293` (VRAM glyph-chunk loader for
the two variants with custom glyphs), `FXCODE_098F33` (sprite-vs-sprite
collision probe). Cross-verified against
`yoshisisland-disassembly/disassembly/bank07.asm` for the Raidenthequick
labels `init_bvz_*` / `main_bvz_*` / `init_baron`, and against
`ys_enmy.asm` / parallel sibling code for the carrier-drop dispatch.

---

## 1. Family at a glance

13 sprites in `yi/Constants/NormalSpriteIDs.asm` (the 12 payload-typed
variants + the bare carrier). The closely-related $0CD (BVZ carrying
Giant Egg) shares the family's drift physics + drop-dispatch tables
but lives under the egg family for catalog reasons; see
`docs/family-eggs.md` §5.3.

| ID | Constant name | Payload index `$7A36,x` | Init handler | Main handler | Released sprite |
|---|---|---|---|---|---|
| `$173` | `BaronVonZeppelinCarryingShyGuy` | `$00` | `$07:F19B` `init_bvz_shyguy` | `$07:F2B2` `main_bvz_simple` | `$01E` Shyguy |
| `$174` | `BaronVonZeppelinCarryingNeedlenose` | `$02` | `$07:F196` `init_bvz_needlenose` | `$07:F2B2` shared `main_bvz_simple` | `$163` BouncingNeedlenose |
| `$175` | `BaronVonZeppelinCarryingBomb` | `$04` | `$07:F191` `init_bvz_bomb` | `$07:F2B2` shared `main_bvz_simple` | `$060` Bomb |
| `$176` | `BaronVonZeppelinCarryingBandit` | `$06` | `$07:F18C` `init_bvz_bandit` | `$07:F2B2` shared `main_bvz_simple` | `$020` Bandit |
| `$177` | `BaronVonZeppelinCarryingLargeSpringBall` | `$08` | `$07:F139` `init_bvz_large_spring_ball` | `$07:F2D1` `main_bvz_large_spring_ball` | `$148` LargeSpringBall |
| `$178` | `BaronVonZeppelinCarrying1up` | `$0A` | `$07:F125` `init_bvz_1up` | `$07:F333` `main_bvz_swing_payload` | `$100` Bubbled1up |
| `$179` | `BaronVonZeppelinCarryingKey` | `$0C` | `$07:F11D` `init_bvz_key` | `$07:F333` shared `main_bvz_swing_payload` | `$027` Key |
| `$17A` | `BaronVonZeppelinCarryingCoins` | `$0E` | `$07:F118` `init_bvz_coins` | `$07:F333` shared `main_bvz_swing_payload` | `$115` Coin shower |
| `$17B` | `BaronVonZeppelinCarryingWatermelon` | `$10` | `$07:F187` `init_bvz_watermelon` | `$07:F2F1` `main_bvz_drop_payload` | `$007` Watermelon |
| `$17C` | `BaronVonZeppelinCarryingFireWatermelon` | `$12` | `$07:F182` `init_bvz_watermelon_fire` | `$07:F2F1` shared `main_bvz_drop_payload` | `$009` FireWatermelon |
| `$17D` | `BaronVonZeppelinCarryingIcyWatermelon` | `$14` | `$07:F17D` `init_bvz_watermelon_icy` | `$07:F310` `main_bvz_watermelon_icy` (= drop + freeze tick) | `$005` IcyWatermelon |
| `$17E` | `BaronVonZeppelinCarryingCrateWith6Stars` | `$16` | `$07:F1FB` `init_bvz_crate_6_stars` | `$07:F391` `main_bvz_crate_6_stars` | `$10E` CrateWith6Stars |
| `$17F` | `BaronVonZeppelin` | (no payload) | `$07:FB24` `init_baron` | `$07:FB3D` 2-state Main | -- |

(StompRt and RideYoshiRt for all 13 entries dispatch to the shared
`init_unused_rtl_stub` at `$03:9A6B` -- the family is not edible and
not bop-killable. The kill path is "egg-hit -> pop -> drop payload";
see §5.)

The $0CD `BaronVonZeppelinCarryingGiantEgg` variant lives at
`$07:F1CB` (Init) / `$07:F2F1` (shares the `main_bvz_drop_payload`
body) and shares this family's drift physics + the 13-entry payload
dispatch tables (its payload index is `$18`). It's catalogued in
`docs/family-eggs.md` §5.3 because the dispensed sprite ($029
GiantEgg) is an egg-family member.

### 1.1 Three-tier Main split

The 12 payload variants partition into four Main bodies. The split
encodes the rendering + release-spawn convention each payload needs:

| Main | Used by | What's distinct |
|---|---|---|
| `main_bvz_simple` (`$07:F2B2`) | $173 Shyguy / $174 Needlenose / $175 Bomb / $176 Bandit | Renders the balloon via `FXCODE_0895B9` (no carried-payload glyph), runs the egg-hit drop path (`CODE_07F412`), the aerial-collision drop path (`CODE_07F497`), and the aim-aligned trigger (`CODE_07F746`). The "simple" payloads inherit the balloon's screen position and X-speed on release. |
| `main_bvz_large_spring_ball` (`$07:F2D1`) | $177 LargeSpringBall | Adds `CODE_03AA52` (off-screen-cull pre-pass) and uses `CODE_07F538` (no egg-hit branch, only aerial/aim release) -- the Spring Ball drops straight down on contact and can't be popped by a stray egg in flight. |
| `main_bvz_drop_payload` (`$07:F2F1`) | $0CD GiantEgg / $17B Watermelon / $17C FireWatermelon | Same body as Spring Ball minus the off-screen cull -- balloon drift + aerial/aim release through `CODE_07F538`. |
| `main_bvz_watermelon_icy` (`$07:F310`) | $17D IcyWatermelon | Identical to `main_bvz_drop_payload` plus a tail `JSL CODE_melon_icy_freeze_tick` so the on-balloon ice glyph keeps animating between pop checks. |
| `main_bvz_swing_payload` (`$07:F333`) | $178 1up / $179 Key / $17A Coins | The payload "swings" beneath the balloon -- the balloon's `$78,x` byte is folded through `LSR LSR ROR LSR` into a SuperFX `R4` argument that drives `FXCODE_0895B9` to render the carrier with a pendulum-swung child. Per-frame XOR of bit 1 of `$78,x` (when `$7400,x != 0`) inverts the swing direction at every "bumped" event so the swing keeps oscillating. Release path is `CODE_07F538`. |
| `main_bvz_crate_6_stars` (`$07:F391`) | $17E CrateWith6Stars | The only variant with three independent animation phases. Picks an offset table from `DATA_07F38B`/`DATA_07F6DB`/`DATA_07F6E1` keyed by `$77,x` (a 3-counter that ticks down per popped star) and renders via `FXCODE_0895F4` (a sibling renderer that takes the offset table as an SFX-side argument). Drop spawns the `$10E` Crate sprite which then dispenses its 6 stars. |

The 2-state `$17F` Main is documented in §4.5; it's NOT one of the
above paths.

---

## 2. The payload-type indexing scheme

Every BVZ variant Init resolves to the same shared body at
`CODE_07F19E` (or its `CODE_07F12B` / `CODE_07F1AA` aliases), which
**stamps a payload index byte** into `$7A36,x`. That byte is the
universal key into two parallel 13-entry tables:

```asm
DATA_07F7A3 / DATA_bvz_payload_sprite_ids:        ; 13 entries, dw
    dw !Define_YI_NorSpr01E_Shyguy                ; index $00 -- $173
    dw !Define_YI_NorSpr163_BouncingNeedlenose    ; index $02 -- $174
    dw !Define_YI_NorSpr060_Bomb                  ; index $04 -- $175
    dw !Define_YI_NorSpr020_Bandit                ; index $06 -- $176
    dw !Define_YI_NorSpr148_LargeSpringBall       ; index $08 -- $177
    dw !Define_YI_NorSpr100_Bubbled1up            ; index $0A -- $178
    dw !Define_YI_NorSpr027_Key                   ; index $0C -- $179
    dw !Define_YI_NorSpr115_Coin                  ; index $0E -- $17A
    dw !Define_YI_NorSpr007_Watermelon            ; index $10 -- $17B
    dw !Define_YI_NorSpr009_FireWatermelon        ; index $12 -- $17C
    dw !Define_YI_NorSpr005_IcyWatermelon         ; index $14 -- $17D
    dw !Define_YI_NorSpr10E_CrateWith6Stars       ; index $16 -- $17E
    dw !Define_YI_NorSpr026_BowserFightGiantEgg   ; index $18 -- $0CD
                                                  ; (NOTE: $0CD pulls $029 GiantEgg
                                                  ; in practice; see §2.1 below)

DATA_07F7BD / DATA_bvz_payload_drop_ptr:          ; 13 routines, dw
    dw CODE_07F7D7   ; index $00 -- Shyguy: spawn-in-slot, force state $02 (init-pending)
    dw CODE_07F857   ; index $02 -- Needlenose: bare spawn, force state $02
    dw CODE_07F808   ; index $04 -- Bomb: spawn, set $78,x = 1 (armed), state $02
    dw CODE_07F82C   ; index $06 -- Bandit: spawn, force sub-state $0C (carry-flee), animation $17, state $02
    dw CODE_07F982   ; index $08 -- LargeSpringBall: pre-call CODE_03AEFD, spawn, re-run YI_NorSpr06C_LargeSpringBall_Init
    dw CODE_07F974   ; index $0A -- 1up: spawn 1up-score effect + despawn (the player is awarded the 1up directly)
    dw CODE_07F86D   ; index $0C -- Key: spawn, persist X-coord ($00) + Y-coord ($02) to $701900/$701902 EXRAM, state $10
    dw CODE_07F908   ; index $0E -- Coins: spawn the coin in-slot, then loop 4 times to spawn coin shower
    dw CODE_07F8A6   ; index $10 -- Watermelon: spawn, JSL CODE_048066 (watermelon init helper)
    dw CODE_07F8A6   ; index $12 -- FireWatermelon: same handler
    dw CODE_07F8A6   ; index $14 -- IcyWatermelon: same handler
    dw CODE_07F8C9   ; index $16 -- CrateWith6Stars: pre-call CODE_03AEFD, spawn $10E, offset Y, re-run YI_NorSpr003_CrateWithKey_Init, state $10
    dw CODE_07F9AD   ; index $18 -- GiantEgg: spawn, set timer $7542 = $40, state $02
```

The Init shim per variant just sets A to the index and falls into
`CODE_07F19E` (or `CODE_07F12B`):

```asm
init_bvz_shyguy:        LDA #$0000       ; payload index 0
                        ; falls through:
CODE_07F19E:
    STA $7A36,x         ; stamp payload type
    LDA #$FFFF
    STA $78,x           ; payload-swing-bit init ($17F-style sentinel)
    LDA $7400,x         ; spawn-side from level data (0 = LR, 2 = RL)
    TAY
CODE_07F1AA:
    LDA DATA_07F110,y   ; -> $FFC0 or $0040 X-speed
    STA XSpeedLo,x
    SEP #$20
    LDA $10
    AND #$03            ; global tick byte low 2 bits
    TAY
    LDA DATA_07F10C,y   ; -> $00 / $02 / $04 / $08
    STA $18,x           ; per-slot anim phase
    REP #$20
    LDA #$0800
    STA $75E2,x         ; scale = 0.5 (the balloon is rendered half-size)
    LDA #$0004
    STA $7542,x         ; sprite-render-priority hint
    RTL
```

The eight variants ($174-$176 + $17B-$17D + $173 shy guy) all use
this exact body. The swing-payload variants ($178/$179/$17A) call
`CODE_07F28B` first (the dedup shim, see §3), then fall in at
`CODE_07F12B` which copies `$7400,x` to `$78,x` -- preserving the
spawn-side for the swing-direction in Main. The four-stage Init
variants ($177 LargeSpringBall, $17E CrateWith6Stars) front-load a
SuperFX glyph load (see §6) before stamping `$7A36,x`.

### 2.1 The $18 index slot and $0CD GiantEgg

Payload index $18 names `$026 BowserFightGiantEgg` in
`DATA_bvz_payload_sprite_ids`, but the drop handler `CODE_07F9AD`
just does `JSL CODE_spawn_sprite` with whatever A was loaded -- and
in practice the $0CD's Init body sets `$7A36,x = $18` and the spawn
runs against the table value. The constant `$026` in the table is
the **render reference** for the in-balloon glyph; the actual
released sprite is whatever the engine resolves through
`CODE_spawn_sprite` (which uses $0CD's slot template). See
`docs/family-eggs.md` §5.3 for the full $029 GiantEgg payload flow;
the discrepancy is noted as a LABEL-LIKELY-WRONG candidate in §8.

### 2.2 The DATA_07F3F8 Y-offset table

A second per-payload-index table tunes the **vertical offset** at
which the payload is released, so each enemy/item type spawns at a
visually-correct distance below the balloon centre:

```asm
DATA_07F3F8:
    dw $FFE8,$FFE8,$FFE8,$FFE0,$FFE8,$FFE8,$FFE8,$FFE8
    dw $FFE8,$FFE8,$FFE8,$0000,$FFE0
```

These are signed Y-deltas in pixels (mostly `-$18`, with `-$20` for
Bandit and Bubbled-1up, `$00` for the Crate, and `-$20` for the
GiantEgg). The release code in `CODE_07F412` / `CODE_07F538` /
`CODE_07F746` reads this offset before computing the pop-VFX and
payload-spawn Y.

---

## 3. Shared Init bodies + the 1up/Key dedup shim

There are three logical "init flavours" in the family:

- **Plain stamp + spawn-side bias** (`CODE_07F19E` -> `CODE_07F1AA`)
  used by $173/$174/$175/$176/$17B/$17C/$17D. Sets `$78,x = $FFFF`
  (the swing-bit sentinel that the swing Main treats as "carrier
  with no swing state yet"). Spawn-side comes straight from
  `$7400,x` (the level designer's "drift from left vs. right" toggle
  encoded in the spawn entry).

- **Plain stamp + dedup + swing-side bias** (`CODE_07F28B` ->
  `CODE_07F12B` -> `CODE_07F1AA`) used by $178 / $179 / $17A. Calls
  the dedup shim `CODE_07F28B` first (see below), then stamps the
  index and falls into `CODE_07F12B` which copies `$7400,x` (level
  spawn-side) into `$78,x` (the swing-direction byte) -- so the
  payload-pendulum starts on the same side the balloon entered
  from. `$7400,x` is then zeroed.

- **VRAM glyph chunk + stamp** ($177 LargeSpringBall, $17E
  CrateWith6Stars). Both call `CODE_03AE60` (the standard SuperFX
  helper for "load a tile chunk into VRAM via FXCODE_088293")
  before stamping. This is needed because the spring-ball and crate
  carry visual glyphs that aren't in the base BVZ tile sheet. The
  $17E case also wires 3 independent per-frame anim-phase bytes
  (`$18,x`, `$19,x`, `$76,x` plus a count at `$77,x = $03`) for the
  three-pose dance the crate runs.

### 3.1 The CODE_07F28B dedup shim

```asm
CODE_07F28B:
    JSL.l CODE_03D3F8                              ; item-memory query: BEQ if not collected
    BEQ.b CODE_07F296
    PLA                                            ; abort -- consume the return addr
    JML.l CODE_03A31E                              ; despawn this slot, free
CODE_07F296:
    LDA.w $70E2,x                                  ; encode our pixel-X/Y into a
    ASL : ASL : ASL : ASL                          ;   12-bit position key for
    AND.w #$FF00                                   ;   item-memory writeback later
    STA.b $00
    LDA.w $7182,x
    LSR : LSR : LSR : LSR
    AND.w #$00FF
    ORA.b $00
    STA.w $7A38,x                                  ; remember our coord key in $7A38,x
    RTS
```

`CODE_03D3F8` consults the level's item-memory bitmap (the same
bitmap that flags collected red coins / flowers). If this BVZ slot
has already been "collected" once -- i.e. the player got the 1up or
the Key in a prior life -- the routine returns non-zero and the shim
pops the caller's return address and JMP's to the despawn helper.

If still active, the second half of the shim packs the spawn-pixel
(X,Y) into a 16-bit item-memory key at `$7A38,x` so the Key drop
(`CODE_07F86D`) and the 1up despawn (`CODE_07FB0A`) can write back
"collected" to item-memory when the player picks the payload up.
Only $178/$179/$17A use this dedup -- the food/enemy variants are
free to respawn every level entry.

### 3.2 What the giant-egg ($0CD) Init does differently

`init_bvz_giant_egg` is structurally similar to the plain bodies
but uses a different X-speed table (`DATA_07F114 = $FF80,$0080` vs
the family-standard `DATA_07F110 = $FFC0,$0040`). It drifts twice as
fast as a regular BVZ.

---

## 4. The Main variants in detail

### 4.1 `main_bvz_simple` ($07:F2B2; $173/$174/$175/$176)

```asm
    STZ R4_LMULTResultLo                ; SFX arg = 0 (no swing offset)
    LDX #FXCODE_0895B9>>16
    LDA #FXCODE_0895B9
    JSL BeginSuperFXProcessingRt        ; render balloon + bare-payload glyph
    LDX $12                             ; restore slot
    JSR CODE_07F9C9                     ; aerial-grab override (see §5.4)
    JSL CODE_03AF23                     ; standard sprite frame-update
    JSR CODE_07F412                     ; egg-hit pop path
    JSR CODE_07F746                     ; aim-aligned drop trigger
    JSR CODE_07F3DB                     ; Y-speed clamp + facing flip ($75E2)
    RTL
```

The four "simple-drop" payloads have no per-frame glyph animation
(the payload's tile is part of the carrier's SFX render); the carrier
falls straight, the release-spawn inherits the carrier's X-velocity
(see `CODE_07F461` in `CODE_07F412`).

### 4.2 `main_bvz_large_spring_ball` ($07:F2D1; $177)

Same as `main_bvz_simple` but with three changes:

- `JSL CODE_03AA52` cull pre-pass at the top (off-screen check that
  the simple variants run inline). Likely because the spring-ball is
  the only one with a SuperFX VRAM glyph chunk that needs reclaiming.
- Skips `CODE_07F412` (no egg-hit branch). The spring ball is
  release-only.
- Uses `CODE_07F538` (aerial + aim release).

### 4.3 `main_bvz_drop_payload` ($07:F2F1; $0CD/$17B/$17C) and `main_bvz_watermelon_icy` ($07:F310; $17D)

These are the "drop the payload straight down, no swing, no
egg-hit pop" variants. Same render call as `main_bvz_simple`, then:

```asm
    JSR CODE_07F9C9                     ; aerial-grab override
    JSL CODE_03AF23                     ; frame-update
    JSR CODE_07F538                     ; aerial + aim drop (no egg-hit)
    JSR CODE_07F497                     ; aerial-collision check (only for spring/melon variants)
    JSR CODE_07F3DB                     ; Y-clamp + flip
    RTL
```

`main_bvz_watermelon_icy` adds a final `JSL CODE_melon_icy_freeze_tick`
which animates the ice glyph on the carried melon.

### 4.4 `main_bvz_swing_payload` ($07:F333; $178/$179/$17A) and `main_bvz_crate_6_stars` ($07:F391; $17E)

The swing variants fold `$78,x` (the swing-direction byte seeded from
the spawn-side at Init) into SuperFX's R4 register:

```asm
    LDA $78,x
    LSR : LSR : ROR : LSR               ; combination: sign-preserving /16
    STA R4_LMULTResultLo                ; -> swing-angle argument for FXCODE
    LDX #FXCODE_0895B9>>16
    LDA #FXCODE_0895B9
    JSL BeginSuperFXProcessingRt
    LDX $12
    JSR CODE_07F9C9
    JSL CODE_03AF23
    LDA $7400,x                         ; if level-data flipped us this frame...
    BEQ skip
    LDA $78,x : EOR #$0002 : STA $78,x  ; ...invert swing direction (mid-flight)
skip:
    STZ $7400,x                         ; consume the flip flag
    JSR CODE_07F538
    JSR CODE_07F497
    JSR CODE_07F3DB
    RTL
```

So the pendulum visual is driven by writing to `$78,x` and the
balloon picks it up next frame. The `$7400,x` flip path is the "I
just got bumped by Yoshi or my partner -- invert swing" hook
(non-zero values are written by the engine when the slot collides).

`main_bvz_crate_6_stars` ($07:F391) extends this further: it reads
`$77,x` (a 3..1 counter tracking how many of the 3 "star groups"
are left) and selects a SuperFX render-anchor offset from
`DATA_07F38B`. Each time a star group is popped, `$77,x` decrements
and the SuperFX render switches to a shorter glyph table. When all 3
groups are consumed, `CODE_07F8C9` spawns the actual `$10E` crate
sprite for Yoshi to grab.

### 4.5 `$17F BaronVonZeppelin_Main` ($07:FB3D)

The bare Baron (no payload, no level-data variant) runs a tiny
2-state dispatcher:

```asm
init_baron:                             ; $07:FB24
    LDA $7400,x : TAY                   ; spawn-side
    LDA DATA_07F110,y                   ; -> X-speed $FFC0 or $0040
    STA XSpeedLo,x
    SEP #$20
    LDA $10 : AND #$03 : TAY            ; global tick low bits
    LDA DATA_07F10C,y : STA $18,x       ; anim-phase ($00/$02/$04/$08)
    REP #$20
    RTL                                 ; (no $7A36 stamp; no $75E2 scale)

YI_NorSpr17F_BaronVonZeppelin_Main:     ; $07:FB3D
    STZ R4_LMULTResultLo
    LDX #FXCODE_0895B9>>16
    LDA #FXCODE_0895B9
    JSL BeginSuperFXProcessingRt
    LDX $12
    JSL CODE_03AF23
    LDA $16,x : TAX
    JMP (DATA_baron_main_state_ptr,x)

DATA_baron_main_state_ptr:              ; $07:FB55 ($16,x: $00 / $02)
    dw CODE_07FB59                      ; state 0: drift + check aim
    dw CODE_07FB5F                      ; state 1: drop-Yoshi cinematic
```

`CODE_07FB59` calls `CODE_07FB8B` (the "egg-hit pop" subroutine --
similar to `CODE_07F412` but specialised) then `CODE_07FBD3` (the
aim-aligned trigger that compares the Baron's X+8 to `$611C` Layer1X
and the Y to `$611E` Layer1Y +/- $0400 -- when both match, sets
`$78,x` to the offset, zeroes X-speed, sets Y-speed to `$0080`,
and bumps `$16,x` by 2 to enter state 1).

`CODE_07FB5F` is the **payload-grab cinematic**: it overrides
Yoshi's Y position (`!EXRAM_YI_Player_YPosLo`) to ride the Baron's
hover, while decrementing `$78,x` toward zero each frame. Once
`$78,x = 0`, the Baron's grip "fails" and Yoshi falls. The
`$60C4 EOR #$0002 STA $7400,x` mirrors Yoshi's facing into the
sprite's facing -- so the visual sells the "carried by the
balloon" pose.

This is what happens in the rare case where the bare $17F is placed
in a level: it spawns, drifts, and grabs Yoshi by overriding his
Y-position for the duration of `$78,x`.

---

## 5. The payload-release mechanism

There are three release entry points; each ends with the same
shared "spawn-via-table" tail.

### 5.1 Egg-hit release (`CODE_07F412`, used by `main_bvz_simple` only)

```asm
CODE_07F412:
    LDY $7D36,x                         ; slot of the egg that struck us (-1 if none)
    DEY : BMI :+ : BEQ :+               ; bail if no hit
    LDA NorSpr_CurrentStatus,y
    CMP #$0010 : BNE :+                 ; bail if the hitter isn't alive
    LDA $7D38,y
    BEQ :+                              ; bail if hitter's "is-egg" flag is 0
    TYX : JSL CODE_03B24B               ; kill the egg slot
    LDX $12
    LDY $7A36,x                         ; payload index
    LDA DATA_07F3F8,y : STA $00         ; Y-offset for the pop VFX
    LDA #$017F                          ; bare Baron sprite ID
    JSL CODE_spawn_sprite_active        ; spawn a free balloon to fly off
    BCC + : ...                         ; if spawn succeeded, clone our state
    + (fall-through builds pop VFX + spawns payload via DATA_bvz_payload_drop_ptr)
```

The interesting wrinkle: on egg-hit, the BVZ first **spawns a fresh
$17F balloon slot** (the popped balloon graphic that drifts upward
post-pop), then dispatches the payload through
`DATA_bvz_payload_drop_ptr`. The original carrier's slot is despawned
via `CODE_039F91` at the end.

### 5.2 Aerial-collision release (`CODE_07F497`)

Uses `FXCODE_098F33` (a SuperFX sprite-overlap probe) to find any
slot whose bbox intersects this one. If a match is found, runs the
same pop-VFX + payload dispatch.

### 5.3 Aim-aligned release (`CODE_07F746`, used by `main_bvz_simple`)

```asm
CODE_07F746:
    LDA $7680,x : CMP #$00F0 : BCS exit ; not yet at screen-Y 240
    LDA $7CD6,x : SEC : SBC $611C       ; carrier-X vs camera-X
    CLC : ADC #$0004
    CMP #$0008 : BCS exit               ; not within +/- 4 px of player
    ; SoundID0E_ShellHit4 cue + spawn bare $17F + payload dispatch
```

So the natural drop-trigger fires when (a) the carrier has descended
to row $F0 on screen and (b) the player is centred under it (4-px
window).

### 5.4 The `CODE_07F9C9` aerial-grab override

```asm
CODE_07F9C9:
    LDA NorSpr_CurrentStatus,x
    CMP #$0008                          ; is the engine state = "tongued"?
    BEQ :+ : RTS
:   LDA $7A36,x : TAX
    LDA DATA_bvz_payload_sprite_ids,x
    JMP (DATA_bvz_payload_release_ptr,x); release via the second dispatch table
```

There's a **second** payload-handler table `DATA_07F9DC /
DATA_bvz_payload_release_ptr` at `$07:F9DC` (13 handlers, distinct
from `DATA_bvz_payload_drop_ptr`). This one handles the "Yoshi
tongued the carrier" case -- Yoshi swallows the balloon and gets the
payload directly in his inventory (1up scored, key consumed, coins
collected) without it ever spawning as a level sprite.

The differences between the two tables:

| Index | `DATA_bvz_payload_drop_ptr` | `DATA_bvz_payload_release_ptr` (eaten) |
|---|---|---|
| $00 Shyguy | `CODE_07F7D7` (spawn into slot, state $02) | `CODE_07F9F9` (spawn variant clone) |
| $02 Needlenose | `CODE_07F857` (bare spawn) | `CODE_07FA2C` (spawn + pop VFX) |
| $04 Bomb | `CODE_07F808` (spawn armed) | `CODE_07FA2C` (same as Needlenose) |
| $06 Bandit | `CODE_07F82C` (carry-flee preset) | `CODE_07F9F6` (RTS only -- no spawn) |
| $08 Spring | `CODE_07F982` (re-init) | `CODE_07F9F6` (RTS only) |
| $0A 1up | `CODE_07F974` (instant-award + despawn) | `CODE_07FABE` (full coin spillage + 1up + despawn) |
| $0C Key | `CODE_07F86D` (persist item-memory) | `CODE_07F9F6` (RTS only) |
| $0E Coins | `CODE_07F908` (coin shower) | `CODE_07FA6F` (coin shower + bonus) |
| $10-$14 Melons | `CODE_07F8A6` (spawn + watermelon init) | `CODE_07FA2C` (spawn + pop VFX) |
| $16 Crate | `CODE_07F8C9` (3-phase crate spawn) | `CODE_07F9F6` (RTS only -- can't be tongue-eaten) |
| $18 GiantEgg | `CODE_07F9AD` (spawn + $7542 timer) | `CODE_07FA16` (spawn + $7542 timer + VFX) |

The "RTS only" handlers (index $06 / $08 / $0C / $16) explicitly
forbid the tongue-eat path -- you can't eat the bandit or the
spring-ball or the key out of a balloon. The 1up and Coins variants
have the most elaborate `_release` handlers because they auto-award
the player directly.

### 5.5 What happens to the carrier post-release

In all release paths, the carrier slot transitions one of three
ways:

1. **State $0002 (Init pending)** -- the carrier's slot is
   re-purposed to hold the newly-spawned payload via
   `CODE_spawn_sprite`. The engine runs the payload's Init on the
   next frame. This is the common case for $173-$176, $17B-$17D.
2. **State $0010 (alive, skip Init)** -- the carrier transmutes to
   become the payload directly with pre-populated fields. Used for
   $179 Key (the carrier becomes the Key) and $17F GiantEgg flows.
3. **Slot freed via `CODE_039F91`** -- the carrier's stage ID is
   cleared and the slot returns to the free pool. Used in
   `CODE_07F412` after spawning the bare $17F post-pop drifter,
   and in `CODE_07F974` for the 1up (which never spawns a level
   sprite at all).

---

## 6. SuperFX usage

The family touches four SuperFX chunks (visible in `yi/SuperFX/SuperFXPtrs_YI.asm`):

| FXCODE | Used by | Purpose |
|---|---|---|
| `FXCODE_088293` | `init_bvz_large_spring_ball` ($177) + `init_bvz_crate_6_stars` ($17E) | VRAM glyph-chunk loader. Both Init bodies wire R6/R12/R13/R8/R9/R3/R2 to point to `FXDATA_550000+$40E0` (spring-ball glyph) / `FXDATA_550000+$2080` (crate glyph), then `JSL BeginSuperFXProcessingRt` to upload the tile chunk into the dynamic-tile VRAM region. `INC $0CF9` afterwards bumps the SuperFX "in-flight" count. |
| `FXCODE_0895B9` | All Mains except $17E | Main BVZ balloon renderer. Takes R4 = swing-offset arg (zero for non-swing variants). Returns the balloon sprite OAM data. |
| `FXCODE_0895F4` | `main_bvz_crate_6_stars` ($17E) only | Variant renderer for the crate-with-stars: takes R0 = source-data bank, R7 = X-offset pulled from `DATA_07F38B[$77,x]`. Renders 1-3 visible star groups based on how many have been popped. |
| `FXCODE_098F33` | `CODE_07F497` + `CODE_07F582` | Sprite-vs-sprite collision probe. R1 = caller slot; returns the colliding slot's ID in R1 (or $FFxx = no hit). |

The two Inits that call `FXCODE_088293` are the only family members
that consume dynamic VRAM, hence the off-screen cull (`CODE_03AA52`)
in `main_bvz_large_spring_ball` -- the glyph slot has to be reclaimed
when the carrier despawns.

The `FXDATA_550000+$xxx` offsets target the same SuperFX-side data
chunk that other sprites with custom on-balloon glyphs (e.g.
$0CD GiantEgg's carrier) also pull from. The family's tile budget
is small -- ~$2080 + ~$40E0 = ~24 KB of glyph data total.

See `docs/mchip.md` for the SuperFX register conventions and the
`BeginSuperFXProcessingRt` trampoline.

---

## 7. Cross-references

- `yi/Constants/NormalSpriteIDs.asm` -- canonical IDs $173-$17F + $0CD,
  each with one-line summary + link to this doc.
- `yi/Banks/Bank07.asm` lines 14107-15640 -- the contiguous BVZ
  block (Init + Main + drop/release tables + Baron $17F).
- `docs/family-eggs.md` §5.3 -- the $0CD BVZ-Giant-Egg variant, the
  13th member of this family by structure. Reused payload tables.
- `docs/family-shyguys.md` -- $173 (BVZ Shy Guy) cross-listed there
  + the family-shyguys table notes both $173 and $176 with summaries.
- `docs/family-bandits.md` §3.8 -- $176 (BVZ Bandit) cross-listed
  + the payload-table semantics.
- `docs/family-spikes.md` -- $163 Bouncing Needlenose (the $174
  payload).
- `docs/family-cannons.md` -- $060 Bomb (the $175 payload).
- `docs/family-misc.md` §11 (Spring Ball entries) -- $148 LargeSpringBall
  (the $177 payload).
- `docs/family-collectibles.md` -- $027 Key, $100 Bubbled1up, $115
  Coin (the $179/$178/$17A payloads).
- `docs/family-misc.md` §2 (Watermelons) -- $007 / $009 / $005
  (the $17B/$17C/$17D payloads).
- `docs/family-misc.md` §10 (Crates) -- $10E CrateWith6Stars (the
  $17E payload).
- `docs/spritestateengine.md` -- engine-level dispatch (`spr_state_main`,
  `spr_state_tongued`); the `_StompRt` / `_RideYoshiRt` slots for
  all 13 BVZ variants alias to `init_unused_rtl_stub` at $03:9A6B.
- `docs/leveldataengine.md` -- how a level-data sprite-list entry of
  ID `$173`..`$17F` populates the slot's per-sprite fields including
  `$7400,x` (spawn-side bit).
- `docs/mchip.md` -- SuperFX register/code conventions used by
  `FXCODE_088293` (VRAM upload) and `FXCODE_0895B9` (balloon
  renderer).
- `ys_enmy.asm` and family-sibling 65816 source -- parallel
  reference for the same Init/Main shapes; the
  `DATA_bvz_payload_sprite_ids` 13-entry table appears verbatim.

---

## 8. Open questions / unclarities / LABEL-LIKELY-WRONG candidates

1. **~~$026 in `DATA_bvz_payload_sprite_ids[$18]` but $029 actually
   spawned~~ -- RESOLVED 2026-05-27 (deep-trace).** Asm trace confirms
   `$026` IS the spawned sprite ID (`CODE_07F9AD` does `JSL
   CODE_spawn_sprite` with A = `DATA_bvz_payload_sprite_ids[$18]` =
   `$026`). The deeper finding: `$026` is NOT functionally equivalent
   to `$029` here -- they take genuinely different code paths via
   `CODE_03BB1D`'s SpriteID checks, and `$026` is being USED AS A
   FLAG to select the BVZ-projectile branch.

   Path: `init_bvz_giant_egg` pre-arms `$78,x = $FFFF` before the
   drop. `CODE_spawn_sprite` zeroes `$7D38,x` but does NOT zero
   direct-page `$78,x`, so post-spawn `$026` Main reads `$7D38=0`,
   takes `JMP CODE_0DFA74`, then `LDA $78,x BNE → JMP CODE_0DFA8F →
   JSL CODE_03BB1D` (Bank03.asm:8068). Inside `CODE_03BB1D` the
   first real branch is `LDY.b $78,x BMI → CODE_03BB2A`, which then
   gates on `SpriteID CMP #$029 BCC` (line 8138, 8155). `$026`
   satisfies `SpriteID < $029` → `BCC CODE_03BBE4` both times,
   bypassing both the "BPL $7FE8 cleanup" and the
   "cinematic-giant-egg" branches that `$029` takes. After
   `CODE_03BBE4`, `$026` checks `SpriteID CMP #$028 (HuffinPuffin)`
   → `BNE CODE_03BC53`, ending in the soaring-egg setup path
   (`SoundID20_SoaringEgg` + `FXCODE_09907C` arc velocity). So `$026`
   here is the **"BVZ giant-egg projectile"** SpriteID-as-flag --
   distinct from `$029`'s `$7AF8`-timer-driven wakeup path (which
   spawns Prince Froggy/Frog Pirate). The naming
   `BowserFightGiantEgg` is misleading; `$026` is dual-role.

2. **`CODE_07F412` egg-hit path -- bare-balloon spawn.** The egg-hit
   pop path spawns a *separate* `$017F` slot via
   `CODE_spawn_sprite_active` (NOT in-place transmutation) before
   dispatching the payload. The reason for spawning a "second"
   balloon is unclear -- it might be the post-pop drift-away
   animation (the empty balloon flies up while the payload falls
   down). Visual confirmation needed.

3. **~~`CODE_07F8C9` Crate spawn path~~ -- RESOLVED 2026-05-27 (deep-trace).**
   `YI_NorSpr003_CrateWithKey_Init` and `YI_NorSpr10E_CrateWith6Stars_Init`
   are *literally the same label* at the same address (`init_crate`
   at Bank0D:1905-1906) -- the `$003` label in the `JSL` is just the
   alphabetically-first alias asar picked. Both crates share Init
   and Main bodies.

   The deeper finding: `init_crate` runs EXACTLY ONCE for the
   BVZ-Crate-6-Stars drop, not twice. `CODE_spawn_sprite` does NOT
   call sprite Init directly -- it only sets up slot state and
   queues the slot for engine-side Init dispatch on the next sprite-
   engine tick. But `CODE_07F8C9` writes `status = $0010` (active)
   at line 15158 BEFORE returning, so the engine sees this slot as
   "already initialised" and dispatches Main directly. The only
   Init call that runs is the manual `JSL init_crate` at line 15156.

   What that manual call sets: `$16,x = 1` (set just before the JSL,
   line 15151) → `init_crate` takes its `LDY $16,x BNE CODE_0D8E84`
   path → SKIPS item-memory registration (lines 1914-1921) → runs the
   tileset-aware Y-offset block (lines 1925-1942). So BVZ-dropped
   crates are deliberately NOT registered in item-memory (transient,
   the BVZ encounter is one-shot, not save-persistent).

   The `+$8 Y-offset` at line 15146-15149 (between spawn and the
   manual Init call) compensates for the BVZ's drop position being
   above the natural rest position; the tileset-aware Y-offset
   inside `init_crate` (another +$8 if BG1 tileset = `$03` jungle or
   `$0D` cave) is the standard tileset-dependent landing
   adjustment.

4. **The "swing payload" main reads `$78,x` as both Init-state byte
   and swing-direction byte.** The shared swing Init copies `$7400,x`
   (spawn-side $00/$02) into `$78,x` AND the swing Init body
   subsequently uses `$78,x` for the swing angle. The `EOR #$0002`
   bit-flip in the swing Main literally toggles the spawn-side bit
   as a swing-state machine. Compact but conflates two meanings;
   the documentation in this doc clarifies both uses.

5. **`CODE_07F28B` only runs for $178/$179/$17A.** $17E
   (CrateWith6Stars) is also a "uniquely-collectible" payload that
   the player typically collects once per level (the crate has 6
   stars, awarding extra lives). Why does the crate variant NOT use
   the dedup shim? Likely because the crate is treated as a *level-
   restart-resettable* prize while the 1up/Key/coin-shower are
   *level-permanent*. Confirming the contract on $7A38,x writeback
   would clarify.

6. **$0CD's catalog placement.** This doc covers 13 sprites ($173-$17F),
   but the $0CD BVZ-Giant-Egg variant structurally belongs here -- it
   uses the same `DATA_bvz_payload_sprite_ids` / `_drop_ptr` / `_release_ptr`
   triple and the same Init shape. It's currently catalogued in
   `docs/family-eggs.md` §5.3 (because the released sprite is an
   egg). The cross-reference in §1 above links both ways; no rename
   recommended -- the egg-family placement remains the canonical
   home.

7. **The `$7D38,y` "is-egg" gate in `CODE_07F412`.** The egg-hit
   release path checks `LDA $7D38,y / BEQ skip` on the colliding
   slot. `$7D38,y` is the "carries-link-data" flag in egg slots
   (set on spawn by the egg Init when the egg is a "real" projectile,
   not a placebo). This means a stray non-projectile egg-shaped slot
   (e.g. a dropped egg from another BVZ?) won't trigger the pop.
   Worth a note in `docs/family-eggs.md`.

8. **No DP-mod variant byte.** Unlike the Shy Guy family, BVZ carriers
   don't decode a level-data variant from pixel position. The payload
   identity is fixed by the sprite-ID itself, not by the spawn coordinate.
   The only level-data input is `$7400,x` (spawn-side: 0 = drift
   right-to-left, 2 = left-to-right). The "variant" is encoded in
   the sprite ID space at level-design time, not at runtime.
